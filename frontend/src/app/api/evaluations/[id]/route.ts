import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { canEvaluate, isMissingColumnError } from "@/lib/evaluation-access";
import {
  normalizeScores,
  parseQuestions,
  scoreValidationMessage,
  validateScores,
} from "@/lib/evaluation-criteria";
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
    // SECURITY: Verify ownership before update. `closed_at` peut ne pas
    // encore exister en base (migration pas encore appliquée) : on retombe
    // sur une sélection sans cette colonne plutôt que de faire échouer tout
    // le PUT (cf. isMissingColumnError).
    let existing: any = null;
    {
      const { data, error } = await supabaseAdmin
        .from("candidate_evaluations")
        .select(
          "member_id, candidate_id, epreuve_id, is_group, closed_at, epreuves(is_group_epreuve, evaluation_questions)",
        )
        .eq("id", id)
        .single();
      if (error && isMissingColumnError(error)) {
        const fallback = await supabaseAdmin
          .from("candidate_evaluations")
          .select(
            "member_id, candidate_id, epreuve_id, is_group, epreuves(is_group_epreuve, evaluation_questions)",
          )
          .eq("id", id)
          .single();
        existing = fallback.data;
      } else {
        existing = data;
      }
    }

    if (!existing) {
      return Response.json({ error: "Evaluation not found" }, { status: 404 });
    }

    // Une évaluation clôturée n'est modifiable par personne d'autre qu'un
    // admin — seul un admin peut la rouvrir (POST .../reopen), après quoi
    // les règles normales ci-dessous s'appliquent de nouveau.
    if (existing.closed_at && !user.isAdmin) {
      return Response.json(
        {
          error:
            "Cette évaluation est clôturée. Seul un administrateur peut la rouvrir.",
          code: "EVALUATION_CLOSED",
        },
        { status: 403 },
      );
    }

    const epreuveIsGroupType = existing.epreuves?.is_group_epreuve === true;

    // Permission rules:
    //   • Admins: always
    //   • Solo eval (is_group=false — entretien classique, ou avis
    //     individuel sur une épreuve de groupe) : uniquement l'auteur
    //   • Note collective d'une VRAIE épreuve de groupe (is_group=true ET
    //     epreuve.is_group_epreuve=true) : n'importe quel membre assigné au
    //     créneau (édition collaborative, comportement existant)
    //   • Note partagée en binôme (is_group=true mais épreuve pas "de
    //     groupe") : uniquement l'auteur — les autres membres du créneau
    //     sont en lecture seule tant qu'ils n'ont pas rouvert via un admin
    let canEdit = user.isAdmin || existing.member_id === user.id;

    if (!canEdit && existing.is_group === true && epreuveIsGroupType) {
      canEdit = await canEvaluate(
        user.id,
        existing.candidate_id,
        existing.epreuve_id,
      );
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
      // Même garde que le POST : chaque note dans [0, points max du critère].
      // Le PUT réécrivait auparavant n'importe quelle valeur (999/3 possible).
      const questions = parseQuestions(existing.epreuves?.evaluation_questions);
      const invalid = validateScores(questions, scores);
      if (invalid) {
        return Response.json(
          { error: scoreValidationMessage(invalid) },
          { status: 400 },
        );
      }
      updateData.scores = JSON.stringify(
        normalizeScores(scores, questions.length ? questions : null),
      );
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
