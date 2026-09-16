import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import {
  getSlotExaminerIds,
  listEvaluableEpreuveIds,
  resolveCandidateSlot,
} from "@/lib/evaluation-access";
import {
  buildClosureIndex,
  evaluationClosure,
} from "@/lib/evaluation-closure";
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

    // Nombre d'examinateurs assignés au créneau du candidat, par épreuve —
    // sert au frontend à savoir si une épreuve individuelle est en binôme
    // (2+ examinateurs sur le créneau => note partagée, un seul la saisit).
    // Non pertinent pour les épreuves "de groupe" : chaque examinateur y
    // dépose son avis individuel, et le travail du groupe est noté à part
    // (une grille par créneau — /api/evaluations/group-note).
    const examinerCounts: Record<string, number> = {};
    await Promise.all(
      (data || [])
        .filter((e: any) => e.is_group_epreuve !== true)
        .map(async (e: any) => {
          const slot = await resolveCandidateSlot(candidateId, e.id);
          examinerCounts[e.id] = slot
            ? (await getSlotExaminerIds(slot.slotId)).length
            : 0;
        }),
    );

    // Notation déjà close ? Même règle que la file d'attente
    // (/api/evaluations/next-candidates) et que la garde d'écriture
    // (POST /api/evaluations) : sans ça le formulaire s'ouvre grand sur un
    // candidat déjà noté et n'échoue qu'à l'enregistrement.
    const groupEpreuveIds = new Set(
      (data || [])
        .filter((e: any) => e.is_group_epreuve === true)
        .map((e: any) => e.id),
    );
    const { data: existingEvals } = await supabaseAdmin
      .from("candidate_evaluations")
      .select(
        "candidate_id, epreuve_id, member_id, is_group, scores, comment, member:members!member_id(id, first_name, last_name, email)",
      )
      .eq("candidate_id", candidateId)
      .in(
        "epreuve_id",
        (data || []).map((e: any) => e.id),
      );

    const closureIndex = buildClosureIndex(existingEvals || [], (id) =>
      groupEpreuveIds.has(id),
    );
    const authorById = new Map<string, any>();
    for (const row of (existingEvals as any[]) || []) {
      if (row.member?.id) authorById.set(row.member.id, row.member);
    }

    const epreuves = (data || []).map((e: any) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      tour: e.tour,
      isGroupEpreuve: e.is_group_epreuve ?? false,
      examinerCount: examinerCounts[e.id] ?? null,
      closure: (() => {
        const verdict = evaluationClosure(closureIndex, {
          candidateId,
          epreuveId: e.id,
          memberId: user.id,
          isGroupEpreuve: e.is_group_epreuve === true,
        });
        if (!verdict.closed) return { closed: false, reason: null, by: null };
        const author = verdict.byMemberId
          ? authorById.get(verdict.byMemberId)
          : null;
        return {
          closed: true,
          reason: verdict.reason,
          by: author
            ? {
                firstName: author.first_name || "",
                lastName: author.last_name || "",
                email: author.email,
              }
            : null,
        };
      })(),
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
