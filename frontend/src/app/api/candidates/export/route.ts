import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import {
  getExaminersByEvaluation,
  mergeExaminers,
} from "@/lib/evaluation-examiners";
import {
  getSecondGridEvaluationsByCandidate,
  toEvaluationRow,
} from "@/lib/second-grid";
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
          is_group,
          members!member_id(id, email, first_name, last_name),
          epreuves(id, name, tour, type, evaluation_questions, is_group_epreuve)
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

    // Une note partagée (binôme / collective) doit apparaître au nom des
    // deux examinateurs inscrits au créneau, pas du seul qui l'a saisie.
    const examinersByEval = await getExaminersByEvaluation(
      (data || []).flatMap((c: any) =>
        (c.candidate_evaluations || []).map((ev: any) => ev.id),
      ),
    );

    // Deuxième grille (ex. proposition commerciale) : une ligne de plus par
    // candidat noté, comptée dans la moyenne comme une épreuve à part.
    const secondGridByCandidate = await getSecondGridEvaluationsByCandidate(
      (data || []).map((c: any) => c.id),
    );

    const withExaminers = (data || []).map((c: any) => ({
      ...c,
      candidate_evaluations: [
        ...(c.candidate_evaluations || []).map((ev: any) => ({
        ...ev,
        examiners: mergeExaminers(
          ev.members
            ? {
                id: ev.members.id,
                email: ev.members.email,
                firstName: ev.members.first_name || "",
                lastName: ev.members.last_name || "",
              }
            : null,
          examinersByEval[ev.id],
        ),
        })),
        ...(secondGridByCandidate[c.id] || []).map(toEvaluationRow),
      ],
    }));

    return Response.json({ data: withExaminers });
  } catch (e: any) {
    return Response.json(
      { error: "Failed to fetch candidates", details: e?.message },
      { status: 500 },
    );
  }
}
