import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { filterActiveEnrollments } from "@/lib/enrollment";
import {
  fetchDayIntervals,
  findAllConflicts,
  timeToMinutes,
  minutesToTime,
  normalizeRoom,
} from "@/lib/slot-conflicts";
import { lockReasonLabel, isMissingColumnError } from "@/lib/slot-lock";
import { notifyMembers } from "@/lib/notifications";
import { sendRoomChangeEmail } from "@/lib/resend";
import { NextRequest } from "next/server";

/**
 * Ouverture de salle couvrant cet horaire, s'il y en a une.
 *
 * Un créneau déplacé qui garderait `opening_id` sur l'ouverture de son ANCIENNE
 * salle ferait mentir le tableau des ouvertures — et surtout, la prochaine
 * modification de cette ouverture le ramènerait silencieusement dans la salle
 * d'origine (cf. « mettre à jour la salle des créneaux conservés »,
 * PUT /api/openings/[id]). Sans ouverture correspondante on renvoie null : le
 * créneau devient autonome, plus aucune ouverture ne le déplacera.
 */
async function findOpeningIdFor(
  epreuveId: string | null | undefined,
  dateStr: string,
  room: string | null | undefined,
  startMin: number,
  endMin: number,
): Promise<string | null> {
  if (!epreuveId || !room || !dateStr) return null;
  const { data } = await supabaseAdmin
    .from("room_openings")
    .select("id, room, start_time, end_time")
    .eq("epreuve_id", epreuveId)
    .eq("date", dateStr);
  const match = (data || []).find(
    (o: any) =>
      normalizeRoom(o.room) === normalizeRoom(room) &&
      timeToMinutes(String(o.start_time).slice(0, 5)) <= startMin &&
      timeToMinutes(String(o.end_time).slice(0, 5)) >= endMin,
  );
  return (match as any)?.id ?? null;
}

/**
 * Le créneau qui gêne peut-il simplement échanger sa salle avec le nôtre ?
 *
 * Oui s'il est VIDE (aucun examinateur affecté, aucun inscrit) et exactement
 * sur le même horaire : permuter les deux salles ne déplace alors personne et
 * ne peut créer aucun chevauchement ailleurs. C'est le cas courant — avec le
 * modèle des ouvertures, toute salle ouverte à cette heure-là porte déjà un
 * créneau, souvent vide. Sans cet échange, aucune salle réellement disponible
 * ne serait proposable (remonté par Felix le 12/09/2026).
 *
 * Un créneau vide n'a été promis à personne : son verrou éventuel ne protège
 * aucun rendez-vous, il n'entre donc pas en jeu ici.
 */
async function loadSwappableSlot(
  slotId: string | undefined,
  startMin: number,
  endMin: number,
): Promise<any | null> {
  if (!slotId) return null;
  const { data } = await supabaseAdmin
    .from("evaluation_slots")
    .select(
      `id, room, date, start_time, end_time, epreuve_id, opening_id,
       members:slot_member_assignments(id),
       enrollments:slot_enrollments(id, status)`,
    )
    .eq("id", slotId)
    .single();
  if (!data) return null;

  const isEmpty =
    ((data as any).members || []).length === 0 &&
    ((data as any).enrollments || []).filter(filterActiveEnrollments).length === 0;
  const sameHours =
    timeToMinutes(String((data as any).start_time).slice(0, 5)) === startMin &&
    timeToMinutes(String((data as any).end_time).slice(0, 5)) === endMin;

  return isEmpty && sameHours ? data : null;
}

// PUT /api/slots/[id] — update a slot (admin)
//
// Changer la SALLE d'un créneau déjà peuplé est une opération courante (deux
// épreuves programmées dans la même salle, salle finalement indisponible…).
// Elle n'est jamais silencieuse : candidats inscrits ET examinateurs affectés
// sont prévenus (message / notification in-app + email), sauf `notify: false`.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  const { id } = await params;

  try {
    const {
      label,
      maxCandidates,
      minMembers,
      allowUnderstaffed,
      simultaneousSlots,
      status,
      room,
      epreuveId,
      startTime,
      endTime,
      durationMinutes,
      tour,
      force,
      notify,
    } = await req.json();

    // Prévenir les intéressés est le comportement par défaut : un créneau
    // déplacé sans avertissement, c'est quelqu'un qui se présente devant une
    // salle vide. `notify: false` reste possible pour corriger une coquille
    // sur un créneau que personne n'a encore vu.
    const shouldNotify = notify !== false;

    const data: Record<string, any> = {};
    if (label !== undefined) data.label = label;
    if (maxCandidates !== undefined) data.max_candidates = maxCandidates;
    if (minMembers !== undefined) data.min_members = minMembers;
    // Ouvert aux candidats malgré un jury incomplet (décision admin). Le
    // quota, lui, reste celui de l'épreuve — cf. lib/publish-understaffing.ts.
    if (allowUnderstaffed !== undefined)
      data.allow_understaffed = allowUnderstaffed === true;
    if (simultaneousSlots !== undefined)
      data.simultaneous_slots = simultaneousSlots;
    if (status !== undefined) data.status = status;
    if (room !== undefined) data.room = room;
    if (epreuveId !== undefined) data.epreuve_id = epreuveId || null;
    if (startTime !== undefined) data.start_time = startTime;
    if (endTime !== undefined) data.end_time = endTime;
    // duration_minutes : recalcul depuis start/end pour rester cohérent
    if (startTime !== undefined && endTime !== undefined) {
      const t2m = (t: string) => {
        const [h, m] = t.split(":").map(Number);
        return h * 60 + (m || 0);
      };
      data.duration_minutes = Math.max(1, t2m(endTime) - t2m(startTime));
    } else if (durationMinutes !== undefined) {
      data.duration_minutes = durationMinutes;
    }
    if (tour !== undefined) data.tour = tour;

    // Horaire ou salle : ce qui définit le rendez-vous annoncé.
    const identityChanged =
      startTime !== undefined || endTime !== undefined || room !== undefined;

    // ══════════════════════════════════════════════════════════════════
    // CRÉNEAU FIGÉ : son identité (horaire, salle) ne change plus
    // ══════════════════════════════════════════════════════════════════
    // Le verrou vaut promesse faite aux examinateurs et aux candidats : « ce
    // créneau ne bougera plus ». Une modification manuelle la romprait aussi
    // sûrement qu'un rebrassage de l'algorithme. On la refuse donc, sauf
    // `force: true` — l'admin garde la main, mais consciemment.
    if (identityChanged) {
      const { data: lockRow, error: lockReadErr } = await supabaseAdmin
        .from("evaluation_slots")
        .select("is_locked, locked_reason")
        .eq("id", id)
        .single();

      // Colonne absente (migration pas encore appliquée) → pas de verrou à
      // faire respecter, on laisse passer comme avant.
      if (!lockReadErr && lockRow?.is_locked && !force) {
        return Response.json(
          {
            error: "creneau_fige",
            message: `Ce créneau est figé (${lockReasonLabel(lockRow.locked_reason)}). Le déplacer romprait le rendez-vous annoncé. Déverrouillez-le d'abord, ou confirmez le déplacement.`,
            locked_reason: lockRow.locked_reason,
          },
          { status: 409 },
        );
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // ÉTAT AVANT MODIFICATION
    // ══════════════════════════════════════════════════════════════════
    // Lu une seule fois, il sert à trois choses : l'anti-chevauchement, savoir
    // ce qui a RÉELLEMENT changé (réenregistrer la même salle ne doit alerter
    // personne) et composer les messages — « salle 204 → salle 210 » est une
    // information exploitable, « salle 210 » seul ne dit pas qu'on a bougé.
    let before: any = null;
    // Créneau vide de la salle d'arrivée avec lequel on permute les salles.
    let swapTarget: any = null;
    let dayStr = "";
    let effStartMin = 0;
    let effEndMin = 0;

    if (identityChanged) {
      const { data: current } = await supabaseAdmin
        .from("evaluation_slots")
        .select(
          `
          date, start_time, end_time, room, epreuve_id,
          epreuve:epreuves(name),
          members:slot_member_assignments(member_id, member:members(id, email, first_name, last_name)),
          enrollments:slot_enrollments(candidate_id, status, candidate:candidates(id, first_name, last_name, email))
          `,
        )
        .eq("id", id)
        .single();
      before = current;

      // ── Anti-chevauchement (changement de salle / d'horaire) ──
      if (before) {
        const effectiveRoom = room !== undefined ? room : before.room;
        const effectiveStart = String(
          startTime !== undefined ? startTime : before.start_time,
        ).slice(0, 5);
        const effectiveEnd = String(
          endTime !== undefined ? endTime : before.end_time,
        ).slice(0, 5);
        dayStr = String(before.date).split("T")[0];
        effStartMin = timeToMinutes(effectiveStart);
        effEndMin = timeToMinutes(effectiveEnd);

        if (effectiveRoom) {
          const intervals = await fetchDayIntervals(dayStr);
          const overlaps = findAllConflicts(
            intervals,
            effectiveRoom,
            effStartMin,
            effEndMin,
            id,
          );
          if (overlaps.length > 0) {
            // Un seul créneau gêne, vide et sur le même horaire → échange des
            // salles au lieu d'un refus. Sinon, quelqu'un est attendu là (ou
            // l'horaire ne coïncide pas) : on refuse comme avant.
            swapTarget =
              overlaps.length === 1
                ? await loadSwappableSlot(
                    overlaps[0].slotId,
                    effStartMin,
                    effEndMin,
                  )
                : null;
            if (!swapTarget) {
              const clash = overlaps[0];
              return Response.json(
                {
                  error: `Chevauchement : ${clash.room} a déjà un créneau ${minutesToTime(clash.startMin)}–${minutesToTime(clash.endMin)} ce jour-là.`,
                },
                { status: 409 },
              );
            }
          }
        }
      }
    }

    const roomChanged =
      !!before &&
      room !== undefined &&
      normalizeRoom(room) !== normalizeRoom(before.room);
    const timeChanged =
      !!before &&
      ((startTime !== undefined &&
        String(startTime).slice(0, 5) !==
          String(before.start_time).slice(0, 5)) ||
        (endTime !== undefined &&
          String(endTime).slice(0, 5) !== String(before.end_time).slice(0, 5)));

    // ══════════════════════════════════════════════════════════════════
    // ÉCHANGE DE SALLES — le créneau vide part dans celle qu'on libère
    // ══════════════════════════════════════════════════════════════════
    // Fait AVANT notre propre mise à jour : les deux créneaux ne doivent à
    // aucun moment se retrouver tous les deux dans la salle d'arrivée. Si la
    // mise à jour suivante échoue, on remet ce créneau où il était.
    if (swapTarget && before) {
      const swapOpeningId = await findOpeningIdFor(
        swapTarget.epreuve_id,
        dayStr,
        before.room,
        effStartMin,
        effEndMin,
      );
      const { error: swapErr } = await supabaseAdmin
        .from("evaluation_slots")
        .update({ room: before.room, opening_id: swapOpeningId })
        .eq("id", swapTarget.id);
      if (swapErr) throw swapErr;
    }

    const SLOT_RETURN = `
        *,
        epreuve:epreuves(name, tour, type),
        members:slot_member_assignments(*, member:members(id, email, first_name, last_name)),
        enrollments:slot_enrollments(*, candidate:candidates(id, first_name, last_name)),
        requests:slot_availability_requests(*, member:members(id, email, first_name, last_name))
      `;
    const writeSlot = (patch: Record<string, any>) =>
      supabaseAdmin
        .from("evaluation_slots")
        .update(patch)
        .eq("id", id)
        .select(SLOT_RETURN)
        .single();

    let { data: slot, error } = await writeSlot(data);

    // `allow_understaffed` arrive par une migration appliquée à la main : entre
    // le déploiement et son exécution, la colonne n'existe pas. Sans ce repli,
    // toute modification de créneau qui la porte échouerait en bloc — y compris
    // un simple changement de statut. On rejoue sans elle et on le signale, à
    // charge pour l'appelant de se rabattre sur ce qu'il peut.
    let understaffedFlagUnavailable = false;
    if (error && data.allow_understaffed !== undefined && isMissingColumnError(error)) {
      console.warn(
        "[slots/:id] Colonne allow_understaffed absente. Appliquez supabase-migration-allow-understaffed.sql.",
      );
      understaffedFlagUnavailable = true;
      const { allow_understaffed: _ignored, ...sansDrapeau } = data;
      ({ data: slot, error } = await writeSlot(sansDrapeau));
    }

    if (error) {
      // L'échange a déjà déplacé le créneau vide : le laisser là créerait le
      // chevauchement que tout ce code s'emploie à empêcher.
      if (swapTarget) {
        const { error: rollbackErr } = await supabaseAdmin
          .from("evaluation_slots")
          .update({ room: swapTarget.room, opening_id: swapTarget.opening_id ?? null })
          .eq("id", swapTarget.id);
        if (rollbackErr) {
          console.error(
            "ÉCHANGE DE SALLES : rollback impossible, créneaux",
            id,
            "et",
            swapTarget.id,
            "possiblement tous deux en salle",
            before?.room,
            rollbackErr,
          );
        }
      }
      throw error;
    }

    // Rattachement du créneau déplacé à l'ouverture de sa nouvelle salle.
    // Fail-soft : son échec ne doit pas annuler un changement déjà appliqué.
    if (roomChanged) {
      try {
        const openingId = await findOpeningIdFor(
          before.epreuve_id,
          dayStr,
          slot.room,
          timeToMinutes(String(slot.start_time).slice(0, 5)),
          timeToMinutes(String(slot.end_time).slice(0, 5)),
        );
        await supabaseAdmin
          .from("evaluation_slots")
          .update({ opening_id: openingId })
          .eq("id", id);
      } catch (e) {
        console.error("Rattachement ouverture (changement de salle) échec:", e);
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // AVERTIR LES INTÉRESSÉS
    // ══════════════════════════════════════════════════════════════════
    // Les DEUX côtés du rendez-vous : les candidats inscrits (message privé
    // + email) et les examinateurs affectés (notification in-app + email).
    // Prévenir les seuls candidats laisserait le jury dans l'ancienne salle.
    // Le créneau échangé, lui, est vide : il n'y a personne à y prévenir.
    const notified = { candidates: 0, members: 0, emails: 0 };

    if (shouldNotify && before && (roomChanged || timeChanged)) {
      const dateLabel = before.date
        ? new Date(before.date).toLocaleDateString("fr-FR", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })
        : "";
      const newStart = String(slot?.start_time || "").substring(0, 5);
      const newEnd = String(slot?.end_time || "").substring(0, 5);
      const timeLabel = `${newStart} – ${newEnd}`;
      const epName = (before as any)?.epreuve?.name || "Épreuve";
      const newRoom = slot?.room || "—";
      const oldRoom = before.room || "—";
      // Salle seule : l'horaire ne bouge pas, on le dit — c'est ce qui évite
      // qu'un candidat croie devoir revérifier toute sa journée.
      const roomOnly = roomChanged && !timeChanged;

      const activeEnrollments = (before.enrollments || []).filter(
        filterActiveEnrollments,
      );
      const assignedMembers = (before.members || [])
        .map((m: any) => m.member)
        .filter((m: any) => m?.id);

      // ── Candidats : message privé ──
      if (activeEnrollments.length > 0) {
        const message = roomOnly
          ? `📍 Changement de salle : votre créneau "${epName}" du ${dateLabel} à ${newStart} a désormais lieu en salle ${newRoom} (au lieu de ${oldRoom}). L'horaire ne change pas.`
          : `⚠️ Votre créneau "${epName}" a été modifié : il a désormais lieu le ${dateLabel} de ${newStart} à ${newEnd} (salle ${newRoom}). Vérifiez votre calendrier.`;
        const rows = activeEnrollments.map((e: any) => ({
          sender_id: null,
          sender_role: "admin",
          sender_name: "Système",
          recipient_id: e.candidate_id,
          recipient_role: "candidate",
          message,
        }));
        try {
          const { error: msgErr } = await supabaseAdmin
            .from("private_messages")
            .insert(rows);
          if (msgErr) throw msgErr;
          notified.candidates = rows.length;
        } catch (e) {
          console.error("Notification candidats (modif créneau) échec:", e);
        }
      }

      // ── Examinateurs : notification in-app ──
      if (assignedMembers.length > 0) {
        notified.members = await notifyMembers(
          assignedMembers.map((m: any) => m.id),
          {
            type: roomOnly ? "slot_room_changed" : "slot_updated",
            title: roomOnly ? "📍 Changement de salle" : "⚠️ Créneau modifié",
            body: roomOnly
              ? `${epName} — ${dateLabel} ${timeLabel} : salle ${oldRoom} → salle ${newRoom}. L'horaire ne change pas.`
              : `${epName} — désormais le ${dateLabel} de ${newStart} à ${newEnd}, salle ${newRoom}.`,
            link: "/dashboard/planning",
          },
        );
      }

      // ── Email (candidats + examinateurs) ──
      // Uniquement pour un changement de SALLE à horaire constant : le
      // gabarit `sendRoomChangeEmail` affirme « la date et l'heure restent
      // identiques ». Un déplacement d'horaire ne passe donc que par les
      // messages ci-dessus plutôt que par un email qui mentirait.
      if (roomOnly) {
        const targets = [
          ...activeEnrollments.map((e: any) => ({
            email: e.candidate?.email,
            firstName: e.candidate?.first_name ?? null,
            role: "candidate" as const,
          })),
          ...assignedMembers.map((m: any) => ({
            email: m.email,
            firstName: m.first_name ?? null,
            role: "member" as const,
          })),
        ].filter((t) => !!t.email);

        const results = await Promise.allSettled(
          targets.map((t) =>
            sendRoomChangeEmail({
              to: t.email,
              firstName: t.firstName,
              epreuve: epName,
              dateLabel,
              timeLabel,
              oldRoom: before.room || null,
              newRoom: slot?.room || null,
              role: t.role,
            }),
          ),
        );
        notified.emails = results.filter(
          (r) => r.status === "fulfilled",
        ).length;
      }
    }

    return Response.json({
      ...slot,
      _notified: notified,
      _swappedWith: swapTarget ? { id: swapTarget.id, room: before?.room } : null,
      // L'appelant a demandé l'ouverture en sous-effectif mais la colonne
      // n'existe pas encore : le reste a été écrit, ce drapeau-là non.
      _understaffedFlagUnavailable: understaffedFlagUnavailable,
    });
  } catch (error) {
    console.error("Update slot error:", error);
    return Response.json({ error: "Failed to update slot" }, { status: 500 });
  }
}

// DELETE /api/slots/[id] — delete a slot (admin)
// Notifie les candidats inscrits avant suppression.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  const { id } = await params;
  // Aligné sur DELETE /api/openings/[id] : un créneau qui a des inscrits ne
  // part pas sans confirmation explicite portée par l'API elle-même. Avant
  // l'audit du 07/09/2026, la seule protection était un `window.confirm()`
  // côté client — un appel direct à l'API supprimait un créneau occupé sans
  // le moindre filet côté serveur.
  const force = req.nextUrl.searchParams.get("force") === "true";

  try {
    // 1. Récupérer les infos du créneau + ses candidats inscrits AVANT suppression
    const { data: slot } = await supabaseAdmin
      .from("evaluation_slots")
      .select(
        `
        id, date, start_time, end_time, room,
        epreuve:epreuves(name),
        enrollments:slot_enrollments(candidate_id, status, candidate:candidates(id, first_name, last_name))
        `,
      )
      .eq("id", id)
      .single();

    // 2. Notifier les candidats inscrits via private_messages
    const enrollments = ((slot as any)?.enrollments || []).filter(
      filterActiveEnrollments,
    );

    if (enrollments.length > 0 && !force) {
      return Response.json(
        {
          error:
            enrollments.length === 1
              ? "Ce créneau a 1 candidat inscrit."
              : `Ce créneau a ${enrollments.length} candidats inscrits.`,
          enrolled: enrollments.length,
          candidates: enrollments.map((e: any) => ({
            id: e.candidate?.id ?? e.candidate_id,
            firstName: e.candidate?.first_name ?? null,
            lastName: e.candidate?.last_name ?? null,
          })),
          requiresForce: true,
        },
        { status: 409 },
      );
    }
    if (enrollments.length > 0) {
      const dateStr = slot?.date
        ? new Date(slot.date).toLocaleDateString("fr-FR", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })
        : "";
      const startTime = String(slot?.start_time || "").substring(0, 5);
      const epName = (slot as any)?.epreuve?.name || "Épreuve";
      const room = slot?.room || "—";

      const rows = enrollments.map((e: any) => ({
        sender_id: null,
        sender_role: "admin",
        sender_name: "Système",
        recipient_id: e.candidate_id,
        recipient_role: "candidate",
        message: `⚠️ Votre créneau "${epName}" du ${dateStr} à ${startTime} (salle ${room}) a été annulé par l'administration. Merci de vous réinscrire à un autre créneau disponible.`,
      }));

      try {
        await supabaseAdmin.from("private_messages").insert(rows);
      } catch (e) {
        console.error("Notification candidats échec:", e);
      }
    }

    // 3. Supprimer le créneau (cascade sur enrollments/assignments via FK)
    const { error } = await supabaseAdmin
      .from("evaluation_slots")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return Response.json({
      success: true,
      notified_candidates: enrollments.length,
    });
  } catch (error) {
    console.error("Delete slot error:", error);
    return Response.json({ error: "Failed to delete slot" }, { status: 500 });
  }
}
