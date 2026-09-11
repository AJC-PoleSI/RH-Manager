import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { fetchAllRows } from "@/lib/supabase-paging";
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

    // 1) Get all valid slot IDs — lecture PAGINÉE et erreur BLOQUANTE.
    //    Avec plus de 1000 créneaux en base (1076 en prod), une lecture non
    //    paginée n'en voyait que 1000 : les inscriptions et affectations des
    //    créneaux invisibles étaient prises pour des orphelines et SUPPRIMÉES.
    //    De même, une lecture en erreur (`data` null) aurait vidé toute la
    //    table : on s'arrête plutôt que de purger sur une vue partielle.
    const { data: allSlots, error: slotsError } = await fetchAllRows<{
      id: string;
    }>((from, to) =>
      supabaseAdmin.from("evaluation_slots").select("id").order("id").range(from, to),
    );
    if (slotsError) throw slotsError;
    const validSlotIds = new Set((allSlots || []).map((s) => s.id));

    // 2) Purge orphan enrollments
    const { data: allEnrolls, error: enrollsError } = await fetchAllRows<any>(
      (from, to) =>
        supabaseAdmin
          .from("slot_enrollments")
          .select("id, slot_id")
          .order("id")
          .range(from, to),
    );
    if (enrollsError) throw enrollsError;
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

    // 3) Purge orphan member assignments (1199 lignes en prod : paginé)
    const { data: allAssigns, error: assignsError } = await fetchAllRows<any>(
      (from, to) =>
        supabaseAdmin
          .from("slot_member_assignments")
          .select("id, slot_id")
          .order("id")
          .range(from, to),
    );
    if (assignsError) throw assignsError;
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
    const { data: allEvals, error: evalsError } = await fetchAllRows<any>(
      (from, to) =>
        supabaseAdmin
          .from("candidate_evaluations")
          .select("id, scores, comment")
          .order("id")
          .range(from, to),
    );
    if (evalsError) throw evalsError;

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
