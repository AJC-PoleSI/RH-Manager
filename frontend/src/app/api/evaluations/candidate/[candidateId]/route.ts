import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import {
  averageOn20ByEpreuve,
  getTotalMaxPoints,
  hasAnyScore,
  normalizeScores,
  sumScores,
  toTwenty,
} from "@/lib/evaluation-criteria";
import {
  getExaminersByEvaluation,
  mergeExaminers,
} from "@/lib/evaluation-examiners";
import {
  GROUP_EVALUATION_MAX,
  GROUP_EVALUATION_QUESTIONS,
  isLegacyCollectiveNote,
} from "@/lib/group-evaluation-criteria";
import { isActiveEnrollment } from "@/lib/enrollment";
import { NextRequest } from "next/server";

// GET /api/evaluations/candidate/[candidateId] - Fetch evaluations for a candidate
// Returns individual evaluations + collective average per epreuve
export async function GET(
  req: NextRequest,
  { params }: { params: { candidateId: string } },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const { candidateId } = params;

  // ── Permission : candidats ne peuvent pas voir les évaluations ──
  if (payload.role === "candidate") {
    return forbidden();
  }

  // ── Membres : accès aux évaluations de tous les candidats ──

  try {
    const { data: evaluations, error } = await supabaseAdmin
      .from("candidate_evaluations")
      .select(
        "*, epreuves(id, name, tour, type, evaluation_questions, is_group_epreuve), members!member_id(id, email, first_name, last_name)",
      )
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const canSeeAllComments = payload.isAdmin;

    // Examinateurs crédités (evaluator_tracking) : une note partagée compte
    // au nom des deux examinateurs inscrits au créneau, même si l'un d'eux ne
    // s'est jamais connecté pour la saisir.
    const examinersByEval = await getExaminersByEvaluation(
      (evaluations || []).map((e: any) => e.id),
    );

    // Parse scores and format each evaluation
    const parsed = (evaluations || []).map((e: any) => {
      const scores = normalizeScores(e.scores);
      const total = sumScores(e.scores);
      // Barème de l'épreuve : permet d'afficher « total / max » et une note
      // sur 20 comparable entre épreuves (même règle que /api/deliberations).
      const maxTotal = getTotalMaxPoints(e.epreuves?.evaluation_questions);

      // « Sa » note : celle qu'il a saisie, mais aussi la note partagée dont
      // il est co-examinateur inscrit — sinon le binôme qui ne s'est pas
      // connecté le jour J ne verrait jamais le commentaire de SA note.
      const isOwnEval =
        e.member_id === payload.id ||
        (examinersByEval[e.id] || []).some((ex) => ex.id === payload.id);

      return {
        id: e.id,
        scores,
        scoreTotal: total,
        maxTotal,
        scoreOn20: hasAnyScore(e.scores) && maxTotal > 0 ? toTwenty(total, maxTotal) : null,
        hasScores: hasAnyScore(e.scores),
        isGroup: e.is_group === true,
        // Ancienne « note collective » d'une épreuve de groupe : conservée
        // pour son commentaire, mais exclue de toutes les moyennes (cf.
        // lib/group-evaluation-criteria).
        isLegacyCollective: isLegacyCollectiveNote(e),
        closedAt: e.closed_at ?? null,
        comment: canSeeAllComments || isOwnEval ? e.comment : null,
        createdAt: e.created_at,
        // BUG FIX : l'intitulé des critères (evaluation_questions) manquait
        // ici — le panneau candidat retombait sur "Critère 1, Critère 2…"
        // faute de pouvoir associer les scores à leur libellé.
        epreuve: e.epreuves
          ? {
              id: e.epreuves.id,
              name: e.epreuves.name,
              tour: e.epreuves.tour,
              type: e.epreuves.type,
              evaluationQuestions: e.epreuves.evaluation_questions,
            }
          : null,
        member: e.members
          ? {
              id: e.members.id,
              email: e.members.email,
              firstName: e.members.first_name || "",
              lastName: e.members.last_name || "",
            }
          : null,
        // Auteur + co-examinateurs crédités (auteur en premier).
        examiners: mergeExaminers(
          e.members
            ? {
                id: e.members.id,
                email: e.members.email,
                firstName: e.members.first_name || "",
                lastName: e.members.last_name || "",
              }
            : null,
          examinersByEval[e.id],
        ),
      };
    });

    // ── Calcul des notes collectives (moyenne) par épreuve ──
    const byEpreuve: Record<
      string,
      {
        epreuve: any;
        evaluations: typeof parsed;
        /** Moyenne des notes de l'épreuve, ramenée sur 20 (null si aucune note). */
        collectiveScore: number | null;
        maxTotal: number;
        evaluatorCount: number;
      }
    > = {};

    parsed.forEach((ev) => {
      const epId = ev.epreuve?.id || "unknown";
      if (!byEpreuve[epId]) {
        byEpreuve[epId] = {
          epreuve: ev.epreuve,
          evaluations: [],
          collectiveScore: null,
          maxTotal: ev.maxTotal,
          evaluatorCount: 0,
        };
      }
      byEpreuve[epId].evaluations.push(ev);
    });

    // Moyenne par épreuve sur 20 — les évaluations sans aucune note (ligne
    // collective créée à vide) sont listées mais ne pèsent pas 0.
    Object.values(byEpreuve).forEach((group) => {
      const scored = group.evaluations.filter(
        (e) => e.hasScores && !e.isLegacyCollective,
      );
      group.evaluatorCount = scored.length;
      group.collectiveScore = averageOn20ByEpreuve(
        scored.map((e) => ({
          epreuveKey: group.epreuve?.id || "unknown",
          obtained: e.scoreTotal,
          maxTotal: e.maxTotal,
        })),
      );
    });

    // Moyenne globale du candidat, même règle que la délibération.
    const globalAverage = averageOn20ByEpreuve(
      parsed
        .filter((e) => e.hasScores && !e.isLegacyCollective)
        .map((e) => ({
          epreuveKey: e.epreuve?.id || "unknown",
          obtained: e.scoreTotal,
          maxTotal: e.maxTotal,
        })),
    );

    return Response.json({
      evaluations: parsed,
      byEpreuve: Object.values(byEpreuve),
      globalAverage,
    });
  } catch (error) {
    console.error("Fetch candidate evaluations error:", error);
    return Response.json(
      { error: "Failed to fetch evaluations" },
      { status: 500 },
    );
  }
}
