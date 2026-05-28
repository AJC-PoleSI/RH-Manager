import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";

// PUT /api/evaluations/[id] - Update an evaluation
// SECURITY: Only the owner (member_id) or admin can update
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();

  const { id } = params;

  try {
    // SECURITY: Verify ownership before update
    const { data: existing } = await supabaseAdmin
      .from("candidate_evaluations")
      .select("member_id, candidate_id, epreuve_id, is_group")
      .eq("id", id)
      .single();

    if (!existing) {
      return Response.json({ error: "Evaluation not found" }, { status: 404 });
    }

    // Permission rules:
    //   • Admins: always
    //   • Individual eval (is_group=false): only the owner (member_id)
    //   • Group eval (is_group=true): any member assigned to a slot of
    //     this épreuve where this candidate is enrolled
    let canEdit = user.isAdmin || existing.member_id === user.id;

    if (!canEdit && existing.is_group === true) {
      const { data: validSlot } = await supabaseAdmin
        .from("slot_member_assignments")
        .select(
          "slot:evaluation_slots!inner(id, epreuve_id, enrollments:slot_enrollments(candidate_id, status))",
        )
        .eq("member_id", user.id);

      canEdit = (validSlot || []).some((row: any) => {
        const s = row.slot;
        if (!s || s.epreuve_id !== existing.epreuve_id) return false;
        return (s.enrollments || [])
          .filter((e: any) => !e.status || e.status === "active")
          .some((e: any) => e.candidate_id === existing.candidate_id);
      });
    }

    if (!canEdit) {
      return forbidden();
    }

    const { scores, comment } = await req.json();

    const updateData: Record<string, unknown> = {
      last_edited_by: user.id,
      updated_at: new Date().toISOString(),
    };
    if (scores !== undefined) {
      // Normaliser en nombres pour éviter la concaténation de strings
      const rawScores =
        typeof scores === "string" ? JSON.parse(scores) : scores || {};
      const normalized: Record<string, number> = {};
      for (const [k, v] of Object.entries(rawScores)) {
        const num = Number(v);
        normalized[k] = Number.isFinite(num) ? num : 0;
      }
      updateData.scores = JSON.stringify(normalized);
    }
    if (comment !== undefined)
      updateData.comment =
        typeof comment === "string" ? comment.substring(0, 5000) : comment;

    const { data, error } = await supabaseAdmin
      .from("candidate_evaluations")
      .update(updateData)
      .eq("id", id)
      .select("*, epreuves(*), members!member_id(email)")
      .single();

    if (error) throw error;

    return Response.json({
      ...data,
      scores:
        typeof data.scores === "string" ? JSON.parse(data.scores) : data.scores,
    });
  } catch (error) {
    console.error("Evaluation PUT error:", error);
    return Response.json(
      { error: "Failed to update evaluation" },
      { status: 400 },
    );
  }
}

// DELETE /api/evaluations/[id] - Delete an evaluation
// SECURITY: Only the owner or admin can delete
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();

  const { id } = params;

  try {
    // SECURITY: Verify ownership before delete
    const { data: existing } = await supabaseAdmin
      .from("candidate_evaluations")
      .select("member_id")
      .eq("id", id)
      .single();

    if (!existing) {
      return Response.json({ error: "Evaluation not found" }, { status: 404 });
    }

    if (existing.member_id !== user.id && !user.isAdmin) {
      return forbidden();
    }

    await supabaseAdmin
      .from("evaluator_tracking")
      .delete()
      .eq("evaluation_id", id);

    const { error } = await supabaseAdmin
      .from("candidate_evaluations")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Evaluation DELETE error:", error);
    return Response.json(
      { error: "Failed to delete evaluation" },
      { status: 400 },
    );
  }
}
