import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { NextRequest } from "next/server";

// GET /api/evaluations - Fetch evaluations (scoped by role)
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  // ── Candidats : pas d'accès aux évaluations ──
  if (payload.role === "candidate") {
    return Response.json({ error: "Acces interdit" }, { status: 403 });
  }

  try {
    let query = supabaseAdmin
      .from("candidate_evaluations")
      .select(
        "*, epreuves(*), candidates(*), members(id, email, first_name, last_name)",
      );

    // ── Membres non-admin : uniquement leurs propres évaluations ──
    if (!payload.isAdmin) {
      query = query.eq("member_id", payload.id);
    }

    const { data: evaluations, error } = await query;

    if (error) throw error;

    const parsed = (evaluations || []).map((e: any) => ({
      id: e.id,
      scores: typeof e.scores === "string" ? JSON.parse(e.scores) : e.scores,
      comment: e.comment,
      createdAt: e.created_at,
      candidate: e.candidates
        ? {
            id: e.candidates.id,
            firstName: e.candidates.first_name,
            lastName: e.candidates.last_name,
          }
        : { id: "", firstName: "", lastName: "" },
      epreuve: e.epreuves
        ? {
            name: e.epreuves.name,
            tour: e.epreuves.tour,
            type: e.epreuves.type,
          }
        : { name: "", tour: 0, type: "" },
      member: e.members
        ? {
            id: e.members.id,
            firstName: e.members.first_name || "",
            lastName: e.members.last_name || "",
            email: e.members.email,
          }
        : null,
    }));

    return Response.json(parsed);
  } catch (error) {
    return Response.json(
      { error: "Failed to fetch evaluations" },
      { status: 500 },
    );
  }
}

// POST /api/evaluations - Submit an evaluation
export async function POST(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();

  const memberId = user.id;

  try {
    const { candidateId, epreuveId, scores, comment } = await req.json();

    if (!candidateId || !epreuveId) {
      return Response.json(
        { error: "candidateId et epreuveId requis" },
        { status: 400 },
      );
    }

    // ══════════════════════════════════════════════════════════════════
    // GARDE ABSOLUE : Anti-double évaluation [Candidat + Épreuve]
    // Un candidat ne peut EN AUCUN CAS passer la même épreuve deux fois.
    // On vérifie TOUS les membres, pas seulement le membre courant.
    // ══════════════════════════════════════════════════════════════════
    const { data: existingEval } = await supabaseAdmin
      .from("candidate_evaluations")
      .select("id, member_id, members(email, first_name, last_name)")
      .eq("candidate_id", candidateId)
      .eq("epreuve_id", epreuveId)
      .limit(1);

    if (existingEval && existingEval.length > 0) {
      // Récupérer les noms pour le message d'erreur exact
      const existingMember = (existingEval[0] as any).members;
      const { data: candidateData } = await supabaseAdmin
        .from("candidates")
        .select("first_name, last_name")
        .eq("id", candidateId)
        .single();

      const memberName = existingMember
        ? `${existingMember.first_name || ""} ${existingMember.last_name || ""}`.trim() ||
          existingMember.email
        : "Un membre";
      const candidateName = candidateData
        ? `${candidateData.first_name || ""} ${candidateData.last_name || ""}`.trim()
        : "ce candidat";

      return Response.json(
        { error: `${memberName} a déjà évalué ${candidateName}` },
        { status: 400 },
      );
    }

    // ══════════════════════════════════════════════════════════════════
    // GARDE : Validation des scores vs. points max des critères
    // Chaque note doit être >= 0 et <= au nombre de points max du critère
    // ══════════════════════════════════════════════════════════════════
    if (scores) {
      const { data: epreuveData } = await supabaseAdmin
        .from("epreuves")
        .select("evaluation_questions")
        .eq("id", epreuveId)
        .single();

      if (epreuveData?.evaluation_questions) {
        const questions: any[] =
          typeof epreuveData.evaluation_questions === "string"
            ? JSON.parse(epreuveData.evaluation_questions)
            : epreuveData.evaluation_questions;

        const parsedScores =
          typeof scores === "string" ? JSON.parse(scores) : scores;

        for (const [key, value] of Object.entries(parsedScores)) {
          const idx = Number(key);
          const scoreVal = Number(value);
          const question = questions[idx];
          if (!question) continue;

          const maxPoints = Number(
            question.weight || question.maxScore || question.coefficient || 20,
          );

          if (scoreVal < 0) {
            return Response.json(
              {
                error: `La note pour le critère "${question.q || question.question}" ne peut pas être négative.`,
              },
              { status: 400 },
            );
          }
          if (scoreVal > maxPoints) {
            return Response.json(
              {
                error: `La note pour le critère "${question.q || question.question}" ne peut pas dépasser ${maxPoints} points.`,
              },
              { status: 400 },
            );
          }
        }
      }
    }

    // ── Création de l'évaluation ──
    const { data: evaluation, error: evalError } = await supabaseAdmin
      .from("candidate_evaluations")
      .insert({
        candidate_id: candidateId,
        epreuve_id: epreuveId,
        member_id: memberId,
        scores: typeof scores === "string" ? scores : JSON.stringify(scores),
        comment,
      })
      .select()
      .single();

    if (evalError) throw evalError;

    // Create evaluator tracking record
    const { error: trackError } = await supabaseAdmin
      .from("evaluator_tracking")
      .insert({
        member_id: memberId,
        candidate_id: candidateId,
        evaluation_id: evaluation.id,
      });

    if (trackError) {
      console.error("Failed to create evaluator tracking:", trackError);
    }

    return Response.json(evaluation, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: "Failed to submit evaluation" },
      { status: 400 },
    );
  }
}
