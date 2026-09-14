import { supabaseAdmin } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/supabase-paging";

/**
 * evaluation-examiners — QUI est crédité d'une note.
 *
 * Une note partagée (binôme sur un entretien, note collective sur une épreuve
 * de groupe) est saisie par UN seul examinateur : `candidate_evaluations.member_id`
 * ne nomme donc que celui qui s'est connecté. Les autres examinateurs INSCRITS
 * au créneau sont enregistrés à la soumission dans `evaluator_tracking`
 * (cf. POST /api/evaluations) — c'est la seule source qui dit « cette note est
 * aussi la tienne », même si le co-examinateur ne s'est jamais connecté.
 *
 * Ce module sert de source unique pour afficher et compter une note au nom de
 * TOUS ses examinateurs inscrits (récap admin, fiche candidat, KPI).
 */

export interface ExaminerRef {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

/** Nombre d'ids d'évaluations envoyés par requête `.in(...)`. */
const ID_CHUNK = 200;

/**
 * Fusionne l'auteur de la note et les examinateurs crédités : l'auteur en
 * premier (c'est lui qui a saisi), puis les co-examinateurs, sans doublon.
 * Un membre absent de `evaluator_tracking` (notes d'avant la mise en place du
 * suivi) retombe donc naturellement sur le seul auteur.
 */
export function mergeExaminers(
  author: ExaminerRef | null,
  tracked: ExaminerRef[] | undefined,
): ExaminerRef[] {
  const out: ExaminerRef[] = [];
  const seen = new Set<string>();
  for (const ex of [...(author ? [author] : []), ...(tracked || [])]) {
    if (!ex?.id || seen.has(ex.id)) continue;
    seen.add(ex.id);
    out.push(ex);
  }
  return out;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Examinateurs crédités par évaluation (id d'évaluation → membres), lus dans
 * `evaluator_tracking`. En cas d'erreur (table absente, migration en attente)
 * on renvoie un objet vide : l'appelant retombe alors sur le seul auteur
 * plutôt que de casser tout l'affichage des notes.
 */
export async function getExaminersByEvaluation(
  evaluationIds: string[],
): Promise<Record<string, ExaminerRef[]>> {
  const ids = Array.from(new Set(evaluationIds.filter(Boolean)));
  if (ids.length === 0) return {};

  const byEval: Record<string, ExaminerRef[]> = {};

  for (const part of chunk(ids, ID_CHUNK)) {
    const { data, error } = await fetchAllRows<any>((from, to) =>
      supabaseAdmin
        .from("evaluator_tracking")
        .select(
          "evaluation_id, member_id, member:members!member_id(id, email, first_name, last_name)",
        )
        .in("evaluation_id", part)
        .order("id")
        .range(from, to),
    );

    if (error) {
      console.error("[evaluation-examiners] tracking illisible:", error);
      return {};
    }

    for (const row of data || []) {
      const evalId = row.evaluation_id;
      const m = row.member;
      if (!evalId || !m?.id) continue;
      if (!byEval[evalId]) byEval[evalId] = [];
      byEval[evalId].push({
        id: m.id,
        firstName: m.first_name || "",
        lastName: m.last_name || "",
        email: m.email,
      });
    }
  }

  return byEval;
}

/**
 * Paires (évaluation, membre crédité) sur TOUTE la base — sans jointure, pour
 * les décomptes (KPI). Erreur => tableau vide, l'appelant retombe sur les
 * seuls auteurs.
 */
export async function getAllExaminerCredits(): Promise<
  Array<{ evaluationId: string; memberId: string }>
> {
  const { data, error } = await fetchAllRows<any>((from, to) =>
    supabaseAdmin
      .from("evaluator_tracking")
      .select("evaluation_id, member_id")
      .order("id")
      .range(from, to),
  );

  if (error) {
    console.error("[evaluation-examiners] tracking illisible (KPI):", error);
    return [];
  }

  return (data || [])
    .filter((r: any) => r.evaluation_id && r.member_id)
    .map((r: any) => ({
      evaluationId: r.evaluation_id,
      memberId: r.member_id,
    }));
}
