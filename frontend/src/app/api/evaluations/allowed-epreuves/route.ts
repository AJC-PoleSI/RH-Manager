import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { listEvaluableEpreuveIds } from "@/lib/evaluation-access";
import { NextRequest } from "next/server";

// GET /api/evaluations/allowed-epreuves?candidateId=X
//
// Épreuves sur lesquelles le membre connecté a le droit d'évaluer CE
// candidat : celles où il est assigné à un créneau sur lequel le candidat est
// inscrit. Les admins reçoivent toutes les épreuves.
//
// Sert à n'afficher que ces épreuves dans le formulaire d'évaluation — le
// serveur applique de toute façon la même règle à l'écriture
// (POST /api/evaluations).
export async function GET(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (user.role !== "member") {
    return Response.json({ error: "Accès interdit" }, { status: 403 });
  }

  const candidateId = req.nextUrl.searchParams.get("candidateId");
  if (!candidateId) {
    return Response.json({ error: "candidateId requis" }, { status: 400 });
  }

  try {
    let query = supabaseAdmin
      .from("epreuves")
      .select(
        "id, name, type, tour, is_group_epreuve, evaluation_questions, date_debut",
      );

    if (!user.isAdmin) {
      const allowedIds = await listEvaluableEpreuveIds(user.id, candidateId);
      if (allowedIds.length === 0) {
        return Response.json({ isAdmin: false, epreuves: [] });
      }
      query = query.in("id", allowedIds);
    }

    const { data, error } = await query;
    if (error) throw error;

    const epreuves = (data || []).map((e: any) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      tour: e.tour,
      isGroupEpreuve: e.is_group_epreuve ?? false,
      evaluationQuestions:
        typeof e.evaluation_questions === "string"
          ? (() => {
              try {
                return JSON.parse(e.evaluation_questions);
              } catch {
                return [];
              }
            })()
          : (e.evaluation_questions ?? []),
    }));

    // Tri stable : par tour puis par nom.
    epreuves.sort(
      (a: any, b: any) =>
        (a.tour || 0) - (b.tour || 0) || String(a.name).localeCompare(String(b.name)),
    );

    return Response.json({ isAdmin: !!user.isAdmin, epreuves });
  } catch (error) {
    console.error("allowed-epreuves error:", error);
    return Response.json(
      { error: "Impossible de charger les épreuves évaluables" },
      { status: 500 },
    );
  }
}
