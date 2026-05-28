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
        "*, epreuves(*), candidates(*), members!member_id(id, email, first_name, last_name)",
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
  // SECURITY (audit #3): only members can submit evaluations. A
  // candidate token would otherwise pollute candidate_evaluations
  // with member_id = their own candidate id.
  if (user.role !== "member") {
    return Response.json({ error: "Accès interdit" }, { status: 403 });
  }

  const memberId = user.id;

  try {
    const { candidateId, epreuveId, scores, comment, isGroup } = await req.json();
    const wantGroupEval = isGroup === true;

    if (!candidateId || !epreuveId) {
      return Response.json(
        { error: "candidateId et epreuveId requis" },
        { status: 400 },
      );
    }

    // ══════════════════════════════════════════════════════════════════
    // SECURITY: only an examinator assigned to a slot of this épreuve
    // where the candidate is enrolled may evaluate them. Admins bypass.
    // ══════════════════════════════════════════════════════════════════
    if (!user.isAdmin) {
      const { data: validSlot } = await supabaseAdmin
        .from("slot_member_assignments")
        .select(
          "slot:evaluation_slots!inner(id, epreuve_id, enrollments:slot_enrollments(candidate_id, status))",
        )
        .eq("member_id", memberId);

      const isAssigned = (validSlot || []).some((row: any) => {
        const s = row.slot;
        if (!s || s.epreuve_id !== epreuveId) return false;
        return (s.enrollments || [])
          .filter((e: any) => !e.status || e.status === "active")
          .some((e: any) => e.candidate_id === candidateId);
      });

      if (!isAssigned) {
        return Response.json(
          {
            error:
              "Vous ne pouvez évaluer que les candidats inscrits sur un créneau auquel vous êtes assigné.",
            code: "NOT_ASSIGNED_TO_SLOT",
          },
          { status: 403 },
        );
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // Anti-doublon : selon le type d'évaluation
    //   • GROUP : au plus UNE évaluation de groupe par (candidate, epreuve)
    //   • INDIVIDUAL : au plus UNE évaluation par (candidate, epreuve, member)
    // ══════════════════════════════════════════════════════════════════
    if (wantGroupEval) {
      const { data: existingGroup } = await supabaseAdmin
        .from("candidate_evaluations")
        .select("id")
        .eq("candidate_id", candidateId)
        .eq("epreuve_id", epreuveId)
        .eq("is_group", true)
        .limit(1);

      if (existingGroup && existingGroup.length > 0) {
        return Response.json(
          {
            error: "Une évaluation collective existe déjà pour ce candidat.",
            code: "GROUP_EVAL_EXISTS",
            id: existingGroup[0].id,
          },
          { status: 409 },
        );
      }
    } else {
      const { data: existingEval } = await supabaseAdmin
        .from("candidate_evaluations")
        .select("id, member_id, members!member_id(email, first_name, last_name)")
        .eq("candidate_id", candidateId)
        .eq("epreuve_id", epreuveId)
        .eq("is_group", false)
        .eq("member_id", memberId)
        .limit(1);

      if (existingEval && existingEval.length > 0) {
        const { data: candidateData } = await supabaseAdmin
          .from("candidates")
          .select("first_name, last_name")
          .eq("id", candidateId)
          .single();
        const candidateName = candidateData
          ? `${candidateData.first_name || ""} ${candidateData.last_name || ""}`.trim()
          : "ce candidat";
        return Response.json(
          { error: `Vous avez déjà évalué ${candidateName} pour cette épreuve.` },
          { status: 400 },
        );
      }
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

    // ── Normalisation des scores : TOUJOURS stocker en nombres ──
    // Sinon "1" + "1" = "11" lors des calculs côté lecture.
    const rawScores =
      typeof scores === "string" ? JSON.parse(scores) : scores || {};
    const normalizedScores: Record<string, number> = {};
    for (const [k, v] of Object.entries(rawScores)) {
      const num = Number(v);
      normalizedScores[k] = Number.isFinite(num) ? num : 0;
    }

    // ── Création de l'évaluation ──
    const { data: evaluation, error: evalError } = await supabaseAdmin
      .from("candidate_evaluations")
      .insert({
        candidate_id: candidateId,
        epreuve_id: epreuveId,
        member_id: memberId,
        scores: JSON.stringify(normalizedScores),
        comment,
        is_group: wantGroupEval,
        last_edited_by: memberId,
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
