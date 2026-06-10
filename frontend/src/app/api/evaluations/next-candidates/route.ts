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
          end_time,
          room,
          status,
          epreuve:epreuves(id, name, tour, type, is_group_epreuve),
          enrollments:slot_enrollments(
            status,
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
      // Include every status where a candidate may be enrolled.
      // (matches /api/slots/my-slots which surfaces the same slots in
      // the member calendar — keeps the two views consistent)
      if (
        !["draft", "open", "ready", "published", "full", "closed"].includes(
          slot.status,
        )
      ) {
        continue;
      }

      for (const e of slot.enrollments || []) {
        if (!e.candidate) continue;
        // Skip cancelled enrollments
        if (e.status && e.status !== "active") continue;
        
        const candidateId = e.candidate.id;
        const epreuveId = slot.epreuve.id;
        // Unique key per candidate per epreuve
        const key = `${candidateId}_${epreuveId}`;

        if (!candidatesMap.has(key)) {
          candidatesMap.set(key, {
            id: candidateId,
            firstName: e.candidate.first_name,
            lastName: e.candidate.last_name,
            epreuve: {
              ...slot.epreuve,
              isGroupEpreuve: slot.epreuve.is_group_epreuve === true,
            },
            slotId: slot.id,
            slotDate: new Date(`${slot.date}T${slot.start_time || "00:00:00"}`),
            slotStartTime: slot.start_time || null,
            slotEndTime: slot.end_time || null,
            slotRoom: slot.room || null,
          });
        }
      }
    }

    let nextCandidates = Array.from(candidatesMap.values());

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

        nextCandidates = nextCandidates.filter(
          c => !evaluatedKeys.has(`${c.id}_${c.epreuve.id}`)
        );
      }
    }

    // 4. Attach the "qui examine qui" claims for the remaining slots so the
    // UI can show who is observing each candidate (group épreuves).
    const slotIds = Array.from(
      new Set(nextCandidates.map((c) => c.slotId).filter(Boolean)),
    );
    if (slotIds.length > 0) {
      const { data: targets } = await supabaseAdmin
        .from("examiner_targets")
        .select(
          "slot_id, candidate_id, member_id, member:members!member_id(first_name, last_name)",
        )
        .in("slot_id", slotIds);

      const targetsByKey = new Map<string, any[]>();
      for (const t of (targets as any[]) || []) {
        const key = `${t.slot_id}_${t.candidate_id}`;
        if (!targetsByKey.has(key)) targetsByKey.set(key, []);
        targetsByKey.get(key)!.push({
          memberId: t.member_id,
          isMe: t.member_id === memberId,
          firstName: t.member?.first_name || "",
          lastName: t.member?.last_name || "",
        });
      }

      nextCandidates = nextCandidates.map((c) => ({
        ...c,
        targets: targetsByKey.get(`${c.slotId}_${c.id}`) || [],
      }));
    } else {
      nextCandidates = nextCandidates.map((c) => ({ ...c, targets: [] }));
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
