import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { filterActiveEnrollments } from "@/lib/enrollment";
import {
  fetchDayIntervals,
  findConflict,
  timeToMinutes,
  minutesToTime,
  normalizeRoom,
} from "@/lib/slot-conflicts";
import { lockReasonLabel } from "@/lib/slot-lock";
import { notifyMembers } from "@/lib/notifications";
import { sendRoomChangeEmail } from "@/lib/resend";
import { NextRequest } from "next/server";

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
        const dateStr = String(before.date).split("T")[0];
        const newStart = timeToMinutes(effectiveStart);
        const newEnd = timeToMinutes(effectiveEnd);

        if (effectiveRoom) {
          const intervals = await fetchDayIntervals(dateStr);
          const overlap = findConflict(
            intervals,
            effectiveRoom,
            newStart,
            newEnd,
            id,
          );
          if (overlap) {
            return Response.json(
              {
                error: `Chevauchement : ${overlap.room} a déjà un créneau ${minutesToTime(overlap.startMin)}–${minutesToTime(overlap.endMin)} ce jour-là.`,
              },
              { status: 409 },
            );
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

    const { data: slot, error } = await supabaseAdmin
      .from("evaluation_slots")
      .update(data)
      .eq("id", id)
      .select(
        `
        *,
        epreuve:epreuves(name, tour, type),
        members:slot_member_assignments(*, member:members(id, email, first_name, last_name)),
        enrollments:slot_enrollments(*, candidate:candidates(id, first_name, last_name)),
        requests:slot_availability_requests(*, member:members(id, email, first_name, last_name))
      `,
      )
      .single();

    if (error) throw error;

    // ══════════════════════════════════════════════════════════════════
    // RATTACHEMENT À L'OUVERTURE DE LA SALLE D'ARRIVÉE
    // ══════════════════════════════════════════════════════════════════
    // Un créneau déplacé qui garderait `opening_id` sur l'ouverture de son
    // ANCIENNE salle ferait mentir le tableau des ouvertures — et surtout, la
    // prochaine modification de cette ouverture le ramènerait silencieusement
    // dans la salle d'origine (cf. « mettre à jour la salle des créneaux
    // conservés », PUT /api/openings/[id]). On le rattache donc à l'ouverture
    // de la salle d'arrivée si elle couvre son horaire, sinon on le détache :
    // il devient un créneau autonome, que plus aucune ouverture ne déplacera.
    // Fail-soft : l'échec de ce rattachement ne doit pas annuler un
    // changement de salle déjà appliqué et déjà annoncé.
    if (roomChanged) {
      try {
        const dateStr = String(before.date).split("T")[0];
        const slotStart = timeToMinutes(String(slot.start_time).slice(0, 5));
        const slotEnd = timeToMinutes(String(slot.end_time).slice(0, 5));
        const { data: openings } = await supabaseAdmin
          .from("room_openings")
          .select("id, room, start_time, end_time")
          .eq("epreuve_id", before.epreuve_id)
          .eq("date", dateStr);
        const match = (openings || []).find(
          (o: any) =>
            normalizeRoom(o.room) === normalizeRoom(slot.room) &&
            timeToMinutes(String(o.start_time).slice(0, 5)) <= slotStart &&
            timeToMinutes(String(o.end_time).slice(0, 5)) >= slotEnd,
        );
        await supabaseAdmin
          .from("evaluation_slots")
          .update({ opening_id: match?.id ?? null })
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

    return Response.json({ ...slot, _notified: notified });
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
