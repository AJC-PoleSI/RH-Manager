import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import {
  canEvaluate,
  getSlotExaminerIds,
  isMissingColumnError,
  resolveCandidateSlot,
} from "@/lib/evaluation-access";
import {
  getTotalMaxPoints,
  normalizeScores,
  parseQuestions,
  scoreValidationMessage,
  validateScores,
} from "@/lib/evaluation-criteria";
import { fetchAllRows } from "@/lib/supabase-paging";
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

    // ── Membres non-admin : leurs propres évaluations + celles des
    // évaluations partagées (binôme) où ils sont attribués comme
    // co-examinateurs sans être l'auteur (member_id) de la ligne ──
    if (!payload.isAdmin) {
      const { data: tracked } = await supabaseAdmin
        .from("evaluator_tracking")
        .select("evaluation_id")
        .eq("member_id", payload.id);
      const trackedIds = (tracked || [])
        .map((r: any) => r.evaluation_id)
        .filter(Boolean);

      query = trackedIds.length
        ? query.or(
            `member_id.eq.${payload.id},id.in.(${trackedIds.join(",")})`,
          )
        : query.eq("member_id", payload.id);
    }

    // Lecture PAGINÉE pour l'admin : le total d'évaluations dépassera 1000
    // au fil des tours (PostgREST tronque silencieusement au-delà).
    const { data: evaluations, error } = await fetchAllRows<any>((from, to) =>
      query.order("id").range(from, to),
    );

    if (error) throw error;

    const parsed = (evaluations || []).map((e: any) => ({
      id: e.id,
      scores: typeof e.scores === "string" ? JSON.parse(e.scores) : e.scores,
      comment: e.comment,
      createdAt: e.created_at,
      // Note partagée (binôme / collective) vs avis individuel : le récap
      // admin ne doit pas présenter une note partagée comme celle de son
      // seul auteur, ni la moyenner avec les avis individuels.
      isGroup: e.is_group === true,
      closedAt: e.closed_at ?? null,
      candidate: e.candidates
        ? {
            id: e.candidates.id,
            firstName: e.candidates.first_name,
            lastName: e.candidates.last_name,
          }
        : { id: "", firstName: "", lastName: "" },
      // maxTotal : total de points de l'épreuve (somme des critères), pour
      // convertir le total brut d'une évaluation en note /20 comparable
      // entre épreuves — même calcul que /api/deliberations.
      epreuve: e.epreuves
        ? {
            id: e.epreuves.id,
            name: e.epreuves.name,
            tour: e.epreuves.tour,
            type: e.epreuves.type,
            maxTotal: getTotalMaxPoints(e.epreuves.evaluation_questions),
          }
        : { id: "", name: "", tour: 0, type: "", maxTotal: 20 },
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

  // Hissés hors du try pour rester accessibles dans le catch (cf. le
  // rattrapage de la course concurrente sur la contrainte unique, en bas).
  let candidateId: string | undefined;
  let epreuveId: string | undefined;
  let wantGroupEval = false;
  // Décision serveur (jamais le client) : cette soumission produit-elle une
  // ligne partagée (is_group=true) ? Vrai pour une épreuve "de groupe" dont
  // le client demande la note collective (comportement existant), ET pour
  // une épreuve individuelle (entretien) dont le créneau du candidat a 2
  // examinateurs assignés ou plus — un seul note, attribué au binôme.
  let effectiveIsGroup = false;

  try {
    const body = await req.json();
    ({ candidateId, epreuveId } = body);
    const { scores, comment, isGroup } = body;
    wantGroupEval = isGroup === true;

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
    const allowed = await canEvaluate(
      memberId,
      candidateId,
      epreuveId,
      user.isAdmin,
    );
    if (!allowed) {
      return Response.json(
        {
          error:
            "Vous ne pouvez évaluer que les candidats inscrits sur un créneau auquel vous êtes assigné, pour cette épreuve.",
          code: "NOT_ASSIGNED_TO_SLOT",
        },
        { status: 403 },
      );
    }

    const { data: epreuveRow } = await supabaseAdmin
      .from("epreuves")
      .select("evaluation_questions, is_group_epreuve")
      .eq("id", epreuveId)
      .single();

    // ══════════════════════════════════════════════════════════════════
    // BINÔME : sur une épreuve individuelle (pas "de groupe"), si le
    // créneau du candidat a 2 examinateurs assignés ou plus, une seule note
    // partagée est autorisée — attribuée à tous les examinateurs du
    // créneau. Décidé côté serveur à partir des assignations réelles,
    // jamais du flag `isGroup` envoyé par le client.
    // ══════════════════════════════════════════════════════════════════
    let attributedMemberIds = [memberId];
    const epreuveIsGroupType = epreuveRow?.is_group_epreuve === true;
    effectiveIsGroup = epreuveIsGroupType ? wantGroupEval : false;

    if (effectiveIsGroup || !epreuveIsGroupType) {
      const slot = await resolveCandidateSlot(candidateId, epreuveId);
      if (slot) {
        const examinerIds = await getSlotExaminerIds(slot.slotId);
        if (!epreuveIsGroupType && examinerIds.length >= 2) {
          effectiveIsGroup = true;
          attributedMemberIds = examinerIds;
        } else if (effectiveIsGroup && examinerIds.length) {
          attributedMemberIds = examinerIds;
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // Anti-doublon : selon le type d'évaluation
    //   • GROUP : au plus UNE évaluation de groupe par (candidate, epreuve)
    //   • INDIVIDUAL : au plus UNE évaluation par (candidate, epreuve, member)
    // ══════════════════════════════════════════════════════════════════
    if (effectiveIsGroup) {
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
    // GARDE : chaque note doit tenir dans [0, points max du critère].
    // Même règle que PUT /api/evaluations/[id] (lib/evaluation-criteria).
    // ══════════════════════════════════════════════════════════════════
    const questions = parseQuestions(epreuveRow?.evaluation_questions);
    const invalid = validateScores(questions, scores);
    if (invalid) {
      return Response.json(
        { error: scoreValidationMessage(invalid) },
        { status: 400 },
      );
    }

    // ── Normalisation : uniquement des nombres, uniquement des critères
    // existants ; une case vide n'est pas stockée (ce n'est pas un 0).
    const normalizedScores = normalizeScores(
      scores,
      questions.length ? questions : null,
    );

    // ── Création de l'évaluation ──
    // Une évaluation à auteur unique (is_group=false, qu'il s'agisse d'un
    // entretien classique ou de l'avis individuel d'un membre sur une
    // épreuve de groupe) se clôture immédiatement à la soumission : seul un
    // admin pourra la rouvrir. Une évaluation partagée (binôme ou note
    // collective) reste ouverte jusqu'à validation explicite (cf.
    // /api/evaluations/[id]/close) pour laisser le temps aux co-examinateurs
    // de la relire et commenter.
    const baseInsert = {
      candidate_id: candidateId,
      epreuve_id: epreuveId,
      member_id: memberId,
      scores: JSON.stringify(normalizedScores),
      comment,
      is_group: effectiveIsGroup,
      last_edited_by: memberId,
    };
    const closeFields = effectiveIsGroup
      ? {}
      : { closed_at: new Date().toISOString(), closed_by: memberId };

    let { data: evaluation, error: evalError } = await supabaseAdmin
      .from("candidate_evaluations")
      .insert({ ...baseInsert, ...closeFields })
      .select()
      .single();

    // Repli : colonnes closed_at/closed_by pas encore migrées en prod (cf.
    // MIGRATIONS_A_APPLIQUER.sql) — on enregistre quand même la note, sans
    // verrouillage automatique, plutôt que de bloquer toute soumission.
    if (evalError && isMissingColumnError(evalError)) {
      console.warn(
        "[evaluations] Colonnes closed_at/closed_by absentes — évaluation " +
          "enregistrée sans clôture automatique. Appliquez la migration " +
          "verrouillage des évaluations.",
      );
      ({ data: evaluation, error: evalError } = await supabaseAdmin
        .from("candidate_evaluations")
        .insert(baseInsert)
        .select()
        .single());
    }

    if (evalError) throw evalError;

    // Attribution de l'évaluation à chaque examinateur du créneau (binôme
    // ou note collective) : une ligne evaluator_tracking par membre, pas
    // seulement pour celui qui a soumis.
    const trackRows = Array.from(
      new Set([...attributedMemberIds, memberId]),
    ).map((mid) => ({
      member_id: mid,
      candidate_id: candidateId,
      evaluation_id: evaluation.id,
    }));
    const { error: trackError } = await supabaseAdmin
      .from("evaluator_tracking")
      .insert(trackRows);

    if (trackError) {
      // Non bloquant : au pire, le tableau de suivi admin sous-compte
      // temporairement le binôme (ex. contrainte unique(evaluation_id) pas
      // encore relâchée par la migration — cf. MIGRATIONS_A_APPLIQUER.sql).
      console.error("Failed to create evaluator tracking:", trackError);
    }

    return Response.json(evaluation, { status: 201 });
  } catch (error: any) {
    // COURSE CONCURRENTE (ex. Business Game : plusieurs examinateurs
    // créent la note collective d'un même candidat au même instant) :
    // celui qui perd la course viole la contrainte unique
    // (candidate_id, epreuve_id) WHERE is_group=true/false. Plutôt que
    // de renvoyer une erreur brute, on relit la ligne créée par le
    // gagnant et on répond comme le fait déjà la pré-vérification plus
    // haut — le frontend sait déjà récupérer ce cas (saveGroupEval).
    if (error?.code === "23505" && candidateId && epreuveId) {
      try {
        let existingQuery = supabaseAdmin
          .from("candidate_evaluations")
          .select("id")
          .eq("candidate_id", candidateId)
          .eq("epreuve_id", epreuveId)
          .eq("is_group", effectiveIsGroup);
        // Contrainte unique individuelle = (candidate_id, epreuve_id,
        // member_id) : sans ce filtre on récupérerait la note d'un autre
        // examinateur.
        if (!effectiveIsGroup)
          existingQuery = existingQuery.eq("member_id", memberId);
        const { data: existing } = await existingQuery.maybeSingle();
        if (existing) {
          return Response.json(
            {
              error: effectiveIsGroup
                ? "Une évaluation partagée existe déjà pour ce candidat."
                : "Vous avez déjà évalué ce candidat pour cette épreuve.",
              code: effectiveIsGroup
                ? "GROUP_EVAL_EXISTS"
                : "INDIVIDUAL_EVAL_EXISTS",
              id: existing.id,
            },
            { status: 409 },
          );
        }
      } catch {
        /* repli sur l'erreur générique ci-dessous */
      }
    }
    console.error("Evaluation POST error:", error);
    return Response.json(
      { error: "Failed to submit evaluation" },
      { status: 400 },
    );
  }
}
