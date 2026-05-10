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
      .select("member_id")
      .eq("id", id)
      .single();

    if (!existing) {
      return Response.json({ error: "Evaluation not found" }, { status: 404 });
    }

    if (existing.member_id !== user.id && !user.isAdmin) {
      return forbidden();
    }

    const { scores, comment } = await req.json();

    const updateData: Record<string, unknown> = {};
    if (scores !== undefined) {
      updateData.scores =
        typeof scores === "string" ? scores : JSON.stringify(scores);
    }
    if (comment !== undefined)
      updateData.comment =
        typeof comment === "string" ? comment.substring(0, 5000) : comment;

    const { data, error } = await supabaseAdmin
      .from("candidate_evaluations")
      .update(updateData)
      .eq("id", id)
      .select("*, epreuves(*), members(email)")
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
