import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
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

  try {
    const { data: rawSlots, error } = await supabaseAdmin
      .from("evaluation_slots")
      .select(
        `
        *,
        epreuve:epreuves(id, name, tour, type, duration_minutes, is_group_epreuve, group_size),
        enrollments:slot_enrollments(candidate_id, status),
        members:slot_member_assignments(id)
      `,
      )
      .in("status", ["published", "ready", "full"])
      .order("date", { ascending: true })
      .order("start_time", { ascending: true });

    if (error) throw error;

    // FIX H1: drop cancelled enrollments so capacity counters and
    // isEnrolled flags reflect only ACTIVE registrations.
    const slots = (rawSlots || []).map((s: any) => ({
      ...s,
      enrollments: (s.enrollments || []).filter(
        (e: any) => !e.status || e.status === "active",
      ),
    }));

    // Pour les candidats: filtre supplémentaire (≥ 1 examinateur OU déjà inscrit).
    // Pour les admins/membres: aucun filtre, ils voient tout.
    const isCandidate = payload.role === "candidate";

    const filtered = (slots || []).filter((slot: any) => {
      const memberCount = slot.members?.length || 0;
      const isEnrolled = isCandidate
        ? slot.enrollments?.some((e: any) => e.candidate_id === candidateId)
        : false;

      // Si admin/membre: tout passe
      if (!isCandidate) return true;
      // Candidat inscrit: toujours visible (pour pouvoir se désinscrire)
      if (isEnrolled) return true;
      // Sinon: seulement si au moins 1 examinateur
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
