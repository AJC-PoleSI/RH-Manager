import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { filterActiveEnrollments } from "@/lib/enrollment";
import { getCandidateWishedPoles } from "@/lib/admission";
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
        epreuve:epreuves(id, name, tour, type, duration_minutes, is_group_epreuve, group_size, is_pole_test, pole),
        enrollments:slot_enrollments(candidate_id, status),
        members:slot_member_assignments(id)
      `,
      );

    if (isCandidate && candidateEnrolledSlotIds.length > 0) {
      // Include slots matching the visible statuses OR any slot the
      // candidate is enrolled in (regardless of status).
      const idList = candidateEnrolledSlotIds.join(",");
      query = query.or(
        `status.in.(open,published,ready,full),id.in.(${idList})`,
      );
    } else {
      query = query.in("status", ["open", "published", "ready", "full"]);
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

    // Pour les candidats: filtre supplémentaire (≥ 1 examinateur OU déjà inscrit).
    // Pour les admins/membres: aucun filtre, ils voient tout.
    const filtered = (slots || []).filter((slot: any) => {
      const memberCount = slot.members?.length || 0;
      const isEnrolled = isCandidate
        ? slot.enrollments?.some((e: any) => e.candidate_id === candidateId)
        : false;

      // Si admin/membre: tout passe
      if (!isCandidate) return true;
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
      // Sinon: ne montrer que les statuts publiquement-visibles avec
      // au moins 1 examinateur affecté.
      if (!["open", "published", "ready", "full"].includes(slot.status)) {
        return false;
      }
      return memberCount >= 1;
    });

    const available = filtered.map((slot: any) => {
      const enrolledCount = slot.enrollments?.length || 0;
      const isFull = enrolledCount >= slot.max_candidates;
      const isEnrolled =
        payload.role === "candidate"
          ? slot.enrollments?.some((e: any) => e.candidate_id === candidateId)
          : false;

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
        room: slot.room || null,
        tour: slot.tour,
        maxCandidates: slot.max_candidates,
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
