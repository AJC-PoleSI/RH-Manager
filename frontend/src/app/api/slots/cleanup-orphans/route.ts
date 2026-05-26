import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";

/**
 * POST /api/slots/cleanup-orphans — admin maintenance endpoint
 *
 * Purges:
 *   • slot_enrollments rows whose slot was deleted
 *   • slot_member_assignments rows whose slot was deleted
 *   • candidate_evaluations rows with empty scores AND empty comments
 *     (i.e., never-finalized evaluations that ghost-lock candidates)
 *
 * Use when a candidate reports "I'm blocked but I'm not enrolled
 * anywhere" or "X says I've been evaluated but I haven't".
 */
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const report: Record<string, number> = {
      orphanEnrollmentsPurged: 0,
      orphanAssignmentsPurged: 0,
      ghostEvaluationsPurged: 0,
    };

    // 1) Get all valid slot IDs
    const { data: allSlots } = await supabaseAdmin
      .from("evaluation_slots")
      .select("id");
    const validSlotIds = new Set((allSlots || []).map((s: any) => s.id));

    // 2) Purge orphan enrollments
    const { data: allEnrolls } = await supabaseAdmin
      .from("slot_enrollments")
      .select("id, slot_id");
    const orphanEnrollIds = (allEnrolls || [])
      .filter((e: any) => !e.slot_id || !validSlotIds.has(e.slot_id))
      .map((e: any) => e.id);

    if (orphanEnrollIds.length > 0) {
      const { error } = await supabaseAdmin
        .from("slot_enrollments")
        .delete()
        .in("id", orphanEnrollIds);
      if (!error) report.orphanEnrollmentsPurged = orphanEnrollIds.length;
    }

    // 3) Purge orphan member assignments
    const { data: allAssigns } = await supabaseAdmin
      .from("slot_member_assignments")
      .select("id, slot_id");
    const orphanAssignIds = (allAssigns || [])
      .filter((a: any) => !a.slot_id || !validSlotIds.has(a.slot_id))
      .map((a: any) => a.id);

    if (orphanAssignIds.length > 0) {
      const { error } = await supabaseAdmin
        .from("slot_member_assignments")
        .delete()
        .in("id", orphanAssignIds);
      if (!error) report.orphanAssignmentsPurged = orphanAssignIds.length;
    }

    // 4) Purge ghost evaluations (no scores, no comment)
    const { data: allEvals } = await supabaseAdmin
      .from("candidate_evaluations")
      .select("id, scores, comment");

    const ghostEvalIds: string[] = [];
    for (const e of allEvals || []) {
      const rawScores = (e as any).scores;
      let hasRealScores = false;
      try {
        const parsed =
          typeof rawScores === "string" ? JSON.parse(rawScores) : rawScores;
        if (parsed && typeof parsed === "object") {
          const values = Object.values(parsed);
          hasRealScores =
            values.length > 0 &&
            values.some(
              (v) =>
                v !== null &&
                v !== "" &&
                v !== undefined &&
                !(typeof v === "number" && isNaN(v)),
            );
        }
      } catch {
        hasRealScores = false;
      }
      const hasComment = !!(
        (e as any).comment && String((e as any).comment).trim()
      );
      if (!hasRealScores && !hasComment) ghostEvalIds.push((e as any).id);
    }

    if (ghostEvalIds.length > 0) {
      const { error } = await supabaseAdmin
        .from("candidate_evaluations")
        .delete()
        .in("id", ghostEvalIds);
      if (!error) report.ghostEvaluationsPurged = ghostEvalIds.length;
    }

    return Response.json({
      ok: true,
      ...report,
    });
  } catch (e: any) {
    console.error("cleanup-orphans error:", e);
    return Response.json(
      { error: "Cleanup failed", details: String(e) },
      { status: 500 },
    );
  }
}
