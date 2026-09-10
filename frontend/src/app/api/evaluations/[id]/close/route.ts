import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { canEvaluate, isMissingColumnError } from "@/lib/evaluation-access";
import { NextRequest } from "next/server";

// POST /api/evaluations/[id]/close
// Valide/clôture une évaluation : plus personne (sauf admin, via
// /reopen) ne peut la modifier après ça. Accessible à tout membre
// assigné au créneau du candidat pour cette épreuve (pas seulement
// l'auteur) — pour qu'un binôme puisse valider une note partagée qu'il
// n'a pas lui-même saisie.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (user.role !== "member" && !user.isAdmin) return forbidden();

  const { id } = params;

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("candidate_evaluations")
    .select("id, member_id, candidate_id, epreuve_id, closed_at")
    .eq("id", id)
    .single();

  if (fetchError && isMissingColumnError(fetchError)) {
    return Response.json(
      {
        error:
          "Clôture des évaluations indisponible pour l'instant (migration en attente).",
      },
      { status: 503 },
    );
  }

  if (!existing) {
    return Response.json({ error: "Evaluation not found" }, { status: 404 });
  }

  // Idempotent : déjà clôturée, on renvoie l'état actuel sans erreur.
  if (existing.closed_at) {
    return Response.json({ id: existing.id, closedAt: existing.closed_at });
  }

  const allowed =
    user.isAdmin ||
    existing.member_id === user.id ||
    (await canEvaluate(user.id, existing.candidate_id, existing.epreuve_id));
  if (!allowed) return forbidden();

  const { data, error } = await supabaseAdmin
    .from("candidate_evaluations")
    .update({ closed_at: new Date().toISOString(), closed_by: user.id })
    .eq("id", id)
    .select("id, closed_at, closed_by")
    .single();

  if (error) {
    console.error("Evaluation close error:", error);
    return Response.json(
      { error: "Impossible de clôturer l'évaluation" },
      { status: 400 },
    );
  }

  return Response.json({ id: data.id, closedAt: data.closed_at });
}
