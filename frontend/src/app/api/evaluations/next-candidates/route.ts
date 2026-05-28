import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const memberId = payload.id;

  try {
    // 1. Fetch slots assigned to this member with candidate enrollments
    const { data: assignments, error: assignError } = await supabaseAdmin
      .from("slot_member_assignments")
      .select(`
        slot:evaluation_slots(
          id,
          date,
          start_time,
          status,
          epreuve:epreuves(id, name, tour, type),
          enrollments:slot_enrollments(
            candidate:candidates(id, first_name, last_name)
          )
        )
      `)
      .eq("member_id", memberId);

    if (assignError) throw assignError;

    // 2. Extract candidates from valid slots
    const candidatesMap = new Map();

    for (const a of assignments || []) {
      const slot = a.slot as any;
      if (!slot || !slot.epreuve) continue;
      // Only include active slots where candidates are enrolled
      if (!["published", "closed"].includes(slot.status)) continue;

      for (const e of slot.enrollments || []) {
        if (!e.candidate) continue;
        
        const candidateId = e.candidate.id;
        const epreuveId = slot.epreuve.id;
        // Unique key per candidate per epreuve
        const key = `${candidateId}_${epreuveId}`;

        if (!candidatesMap.has(key)) {
          candidatesMap.set(key, {
            id: candidateId,
            firstName: e.candidate.first_name,
            lastName: e.candidate.last_name,
            epreuve: slot.epreuve,
            slotDate: new Date(`${slot.date}T${slot.start_time || "00:00:00"}`)
          });
        }
      }
    }

    const nextCandidates = Array.from(candidatesMap.values());

    // 3. Filter out those who have ALREADY been evaluated by THIS member for THIS epreuve
    if (nextCandidates.length > 0) {
      // Only filter out candidates where THIS member has submitted their
      // INDIVIDUAL evaluation. Shared/group evaluations are tracked separately
      // and don't count as "done" for an individual member.
      const { data: existingEvals, error: evalsError } = await supabaseAdmin
        .from("candidate_evaluations")
        .select("candidate_id, epreuve_id, is_group")
        .eq("member_id", memberId);

      if (!evalsError && existingEvals) {
        // Only count INDIVIDUAL evals (is_group !== true) as "done" — a member
        // can still owe an individual eval even if the group eval exists.
        const evaluatedKeys = new Set(
          existingEvals
            .filter((ev: any) => ev.is_group !== true)
            .map(ev => `${ev.candidate_id}_${ev.epreuve_id}`)
        );
        
        const filtered = nextCandidates.filter(
          c => !evaluatedKeys.has(`${c.id}_${c.epreuve.id}`)
        );

        // Sort by slot date (upcoming first)
        filtered.sort((a, b) => a.slotDate.getTime() - b.slotDate.getTime());

        return Response.json(filtered);
      }
    }

    // Sort by slot date (upcoming first)
    nextCandidates.sort((a, b) => a.slotDate.getTime() - b.slotDate.getTime());

    return Response.json(nextCandidates);
  } catch (error) {
    console.error("Error fetching next candidates:", error);
    return Response.json(
      { error: "Failed to fetch next candidates" },
      { status: 500 }
    );
  }
}
