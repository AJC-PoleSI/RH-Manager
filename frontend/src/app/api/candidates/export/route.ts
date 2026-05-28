import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { NextRequest } from "next/server";

// GET /api/candidates/export
// Returns verified candidates with all evaluations grouped by tour for Excel export
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  if (payload.role === "candidate" || !payload.isAdmin) {
    return Response.json({ error: "Accès interdit" }, { status: 403 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("candidates")
      .select(
        `
        id,
        first_name,
        last_name,
        email,
        email_verified,
        comments,
        deliberation:deliberations(pros_comment, cons_comment, global_comments, tour1_status, tour2_status, tour3_status),
        candidate_evaluations(
          id,
          scores,
          comment,
          created_at,
          members!member_id(email, first_name, last_name),
          epreuves(id, name, tour, type, evaluation_questions)
        )
      `,
      )
      .eq("email_verified", true)
      .order("last_name", { ascending: true });

    if (error) {
      return Response.json(
        { error: "Failed to fetch candidates", details: error.message },
        { status: 500 },
      );
    }

    return Response.json({ data: data || [] });
  } catch (e: any) {
    return Response.json(
      { error: "Failed to fetch candidates", details: e?.message },
      { status: 500 },
    );
  }
}
