import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import {
  filterActiveEnrollments,
  effectiveMaxCandidates,
} from "@/lib/enrollment";
import { slotGroupKey, pickPackedRoom } from "@/lib/room-packing";
import { getCandidateWishedPoles } from "@/lib/admission";
import { getToursByNumber } from "@/lib/tour-status";
import { NextRequest } from "next/server";

// GET /api/slots/available — créneaux que le candidat peut voir
//
// Règles d'affichage (priorité):
//   1. Le candidat voit TOUJOURS les créneaux où il est inscrit
//      (même si "full" ou si l'examinateur s'est désinscrit après coup),
//      sinon il ne pourrait plus se désinscrire.
//   2. Sinon, filtrer par status "published"/"ready"/"full"
//      ET au moins 1 examinateur affecté (members.length >= 1).
//      → Les créneaux sans examinateur ne sont pas exposés aux candidats.
//      → Quand un examinateur s'inscrit, le créneau apparaît automatiquement.
//   3. Les status "draft"/"open" restent invisibles (pas encore publiés).
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const candidateId = payload.id;
  const isCandidate = payload.role === "candidate";

  try {
    // ══════════════════════════════════════════════════════════════════
    // FIX: pre-fetch the candidate's enrolled slot IDs so we can
    // INCLUDE those slots in the result even when their status is
    // outside the visible set (draft / closed / etc).
    //
    // Without this, a candidate enrolled in a "closed" or "draft" slot
    // would see NO slot card for it in the calendar — yet the cross-
    // épreuve check would block any new inscription. They could not
    // even click "Se désinscrire" because the slot wasn't in the list.
    // Exact bug reported: "Vous êtes déjà inscrit à un autre créneau
    // pour cette épreuve : mercredi 16 sept 08:00…" but the slot never
    // appeared in the candidate's calendar.
    // ══════════════════════════════════════════════════════════════════
    let candidateEnrolledSlotIds: string[] = [];
    if (isCandidate) {
      const { data: myEnrolls } = await supabaseAdmin
        .from("slot_enrollments")
        .select("slot_id, status")
        .eq("candidate_id", candidateId);
      candidateEnrolledSlotIds = (myEnrolls || [])
        .filter((e: any) => e.status !== "cancelled" && e.slot_id)
        .map((e: any) => e.slot_id);
    }

    let query = supabaseAdmin
      .from("evaluation_slots")
      .select(
        `
        *,
        epreuve:epreuves(id, name, tour, type, duration_minutes, is_group_epreuve, group_size, min_candidates, is_pole_test, pole),
        enrollments:slot_enrollments(candidate_id, status),
        members:slot_member_assignments(id)
      `,
      );

    // PUBLICATION PAR ÉPREUVE : un candidat ne voit que les créneaux
    // explicitement publiés ("published"/"full"). Les statuts draft/open/
    // ready restent invisibles tant que l'admin n'a pas publié l'épreuve.
    // Les membres/admins voient aussi les statuts de travail.
    const candidateStatuses = ["published", "full"];
    const memberStatuses = ["open", "published", "ready", "full"];

    if (isCandidate && candidateEnrolledSlotIds.length > 0) {
      // Include slots matching the visible statuses OR any slot the
      // candidate is enrolled in (regardless of status).
      const idList = candidateEnrolledSlotIds.join(",");
      query = query.or(
        `status.in.(${candidateStatuses.join(",")}),id.in.(${idList})`,
      );
    } else if (isCandidate) {
      query = query.in("status", candidateStatuses);
    } else {
      query = query.in("status", memberStatuses);
    }

    const { data: rawSlots, error } = await query
      .order("date", { ascending: true })
      .order("start_time", { ascending: true });

    if (error) throw error;

    // FIX H1: drop cancelled enrollments so capacity counters and
    // isEnrolled flags reflect only ACTIVE registrations.
    const slots = (rawSlots || []).map((s: any) => ({
      ...s,
      enrollments: (s.enrollments || []).filter(
        filterActiveEnrollments,
      ),
    }));

    // TOUR 3 : pôles demandés par le candidat — les épreuves de pôle des
    // autres pôles ne lui sont pas proposées.
    const wishedPoles = isCandidate
      ? await getCandidateWishedPoles(candidateId)
      : [];
    // VISIBILITÉ TOURS : défense en profondeur, même si en pratique un
    // créneau d'un tour "a_venir" n'est pas encore publié.
    const toursByNumber = isCandidate ? await getToursByNumber() : {};

    // Pour les candidats: filtre supplémentaire (≥ 1 examinateur OU déjà inscrit).
    // Pour les admins/membres: aucun filtre, ils voient tout.
    const filtered = (slots || []).filter((slot: any) => {
      const memberCount = slot.members?.length || 0;
      const isEnrolled = isCandidate
        ? slot.enrollments?.some((e: any) => e.candidate_id === candidateId)
        : false;

      // Si admin/membre: tout passe
      if (!isCandidate) return true;
      // VISIBILITÉ TOURS : tour de l'épreuve pas encore commencé → invisible,
      // MÊME si le candidat y est inscrit (ne devrait pas arriver en usage
      // normal — l'inscription est bloquée pour un tour "a_venir" — mais ne
      // doit jamais fuiter via une inscription historique/de test).
      if (toursByNumber[slot.epreuve?.tour]?.status === "a_venir") {
        return false;
      }
      // Candidat inscrit: TOUJOURS visible (pour pouvoir se désinscrire),
      // quel que soit le statut du slot (open/closed/draft inclus).
      if (isEnrolled) return true;
      // TOUR 3 : épreuve de pôle d'un pôle non demandé → invisible.
      if (
        slot.epreuve?.is_pole_test &&
        slot.epreuve?.pole &&
        !wishedPoles.includes(slot.epreuve.pole)
      ) {
        return false;
      }
      // Sinon: ne montrer que les statuts PUBLIÉS dont le jury est AU COMPLET.
      //
      // Le seuil est le minimum de l'épreuve (`min_members`), pas « au moins
      // un examinateur » : un créneau ne doit jamais être réservable tant
      // qu'il n'a pas le jury requis pour se tenir. C'est la même règle que
      // la publication côté dispatch (cf. `requiredForPublish`) — ce filtre
      // en est le garde-fou côté lecture, pour les créneaux gelés ou
      // verrouillés dont le statut n'est plus recalculé.
      if (!["published", "full"].includes(slot.status)) {
        return false;
      }
      return memberCount >= (slot.min_members || 2);
    });

    // ── Regroupement des salles parallèles (candidats uniquement) ──
    //
    // Plusieurs salles peuvent porter la MÊME épreuve au MÊME horaire. Le
    // candidat ne doit pas avoir à choisir laquelle : il choisit un horaire,
    // et le système remplit une salle avant d'en ouvrir une autre
    // (cf. room-packing.ts). Sans ça, les inscriptions s'éparpillent et les
    // examinateurs doivent se déplacer pour suivre les candidats.
    //
    // Une fois inscrit, le candidat voit SA salle : c'est son point de
    // rendez-vous. Les membres et admins, eux, continuent de voir le détail
    // salle par salle.
    const groupsForCandidate = new Map<string, any[]>();
    if (isCandidate) {
      for (const slot of filtered) {
        const key = slotGroupKey(slot);
        if (!groupsForCandidate.has(key)) groupsForCandidate.set(key, []);
        groupsForCandidate.get(key)!.push(slot);
      }
    }

    // Un seul représentant par horaire côté candidat : celui de SA salle s'il
    // est inscrit, sinon la salle que le système lui attribuerait.
    const representatives = !isCandidate
      ? filtered
      : Array.from(groupsForCandidate.values()).map((group: any[]) => {
          const mine = group.find((s: any) =>
            s.enrollments?.some((e: any) => e.candidate_id === candidateId),
          );
          if (mine) return mine;
          const pick = pickPackedRoom(
            group.map((s: any) => ({
              slotId: s.id,
              room: s.room || null,
              enrolledCount: s.enrollments?.length || 0,
              capacity: effectiveMaxCandidates(s),
              juryInPlace: (s.members?.length || 0) > 0,
            })),
          );
          return group.find((s: any) => s.id === pick?.slotId) || group[0];
        });

    const available = representatives.map((slot: any) => {
      const group = isCandidate
        ? groupsForCandidate.get(slotGroupKey(slot)) || [slot]
        : [slot];
      const mine = isCandidate
        ? group.find((s: any) =>
            s.enrollments?.some((e: any) => e.candidate_id === candidateId),
          )
        : undefined;

      // Côté candidat, capacité et remplissage se lisent sur TOUT l'horaire,
      // pas sur une salle : c'est l'horaire qu'il réserve.
      const enrolledCount = group.reduce(
        (n: number, s: any) => n + (s.enrollments?.length || 0),
        0,
      );
      const effectiveMax = group.reduce(
        (n: number, s: any) => n + effectiveMaxCandidates(s),
        0,
      );
      const isFull = enrolledCount >= effectiveMax;
      const isEnrolled = Boolean(mine);

      // Salle masquée tant que le candidat n'est pas inscrit ; une fois
      // inscrit, il voit la sienne.
      const visibleRoom = isCandidate
        ? mine
          ? mine.room || null
          : null
        : slot.room || null;

      return {
        id: slot.id,
        epreuve: slot.epreuve
          ? {
              id: slot.epreuve.id,
              name: slot.epreuve.name,
              tour: slot.epreuve.tour,
              type: slot.epreuve.type,
              durationMinutes: slot.epreuve.duration_minutes,
            }
          : null,
        date: slot.date,
        startTime: slot.start_time,
        endTime: slot.end_time,
        durationMinutes: slot.duration_minutes,
        label: slot.label,
        room: visibleRoom,
        tour: slot.tour,
        maxCandidates: effectiveMax,
        // Minimum de candidats visé pour cette épreuve de groupe (business
        // game, etc.) — null si non applicable (épreuve individuelle ou
        // minimum non configuré). Sert à inciter les candidats à rejoindre
        // un créneau déjà entamé plutôt que d'en ouvrir un nouveau.
        minCandidates: slot.epreuve?.is_group_epreuve
          ? slot.epreuve?.min_candidates ?? null
          : null,
        enrolledCount,
        isFull,
        isEnrolled,
      };
    });

    // FIX C4: no-store so candidate sees fresh slot state immediately
    // after enrolling/canceling.
    return new Response(JSON.stringify(available), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Available slots error:", error);
    return Response.json(
      { error: "Failed to fetch available slots" },
      { status: 500 },
    );
  }
}
