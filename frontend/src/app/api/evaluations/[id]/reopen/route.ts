import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { isMissingColumnError } from "@/lib/evaluation-access";
import { NextRequest } from "next/server";

// POST /api/evaluations/[id]/reopen
// SECURITY: admin only. Une évaluation clôturée (cf. .../close, ou une
// évaluation individuelle classique clôturée automatiquement à la
// soumission) ne redevient modifiable par son auteur/binôme qu'après
// réouverture explicite par un admin.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  const { id } = params;

  const { data, error } = await supabaseAdmin
    .from("candidate_evaluations")
    .update({
      closed_at: null,
      closed_by: null,
      reopened_at: new Date().toISOString(),
      reopened_by: user.id,
    })
    .eq("id", id)
    .select("id, closed_at")
    .single();

  if (error) {
    if (isMissingColumnError(error)) {
      return Response.json(
        {
          error:
            "Réouverture des évaluations indisponible pour l'instant (migration en attente).",
        },
        { status: 503 },
      );
    }
    console.error("Evaluation reopen error:", error);
    return Response.json(
      { error: "Impossible de rouvrir l'évaluation" },
      { status: 400 },
    );
  }

  if (!data) {
    return Response.json({ error: "Evaluation not found" }, { status: 404 });
  }

  return Response.json({ id: data.id, closedAt: data.closed_at });
}
