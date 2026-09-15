import { supabaseAdmin } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/supabase-paging";
import { isActiveEnrollment } from "@/lib/enrollment";
import {
  GROUP_EVALUATION_MAX,
  GROUP_EVALUATION_QUESTIONS,
} from "@/lib/group-evaluation-criteria";
import {
  getCriterionLabel,
  getMaxPoints,
  normalizeScores,
  sumScores,
  toTwenty,
} from "@/lib/evaluation-criteria";

/**
 * Lecture des ÉVALUATIONS DU GROUPE (business games) pour affichage.
 *
 * La grille est stockée par CRÉNEAU (`group_evaluations.slot_id`) : pour la
 * montrer sur la fiche d'un candidat il faut passer par son inscription.
 * Cette note est INDICATIVE — elle n'entre dans aucune moyenne (cf.
 * lib/group-evaluation-criteria.ts).
 */

export interface GroupEvaluationView {
  id: string;
  slotId: string;
  epreuve: { id: string; name: string; tour: number | null } | null;
  /** Détail critère par critère, prêt à afficher. */
  criteria: Array<{ label: string; score: number | null; maxPoints: number }>;
  scoreTotal: number;
  maxTotal: number;
  scoreOn20: number;
  comment: string;
  author: { firstName: string; lastName: string; email: string } | null;
  updatedAt: string | null;
}

/** Table absente : migration group_evaluations pas encore appliquée. */
function isMissingTable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = String((err as { code?: unknown }).code ?? "");
  return code === "PGRST205" || code === "42P01";
}

function view(row: any): GroupEvaluationView {
  const scores = normalizeScores(row.scores, GROUP_EVALUATION_QUESTIONS);
  const total = sumScores(row.scores);
  const author = row.author;
  return {
    id: row.id,
    slotId: row.slot_id,
    epreuve: row.epreuve
      ? {
          id: row.epreuve.id,
          name: row.epreuve.name,
          tour: row.epreuve.tour ?? null,
        }
      : null,
    criteria: GROUP_EVALUATION_QUESTIONS.map((q, idx) => ({
      label: getCriterionLabel(q),
      score: scores[String(idx)] ?? null,
      maxPoints: getMaxPoints(q),
    })),
    scoreTotal: total,
    maxTotal: GROUP_EVALUATION_MAX,
    scoreOn20: toTwenty(total, GROUP_EVALUATION_MAX),
    comment: row.comment || "",
    author: author
      ? {
          firstName: author.first_name || "",
          lastName: author.last_name || "",
          email: author.email,
        }
      : null,
    updatedAt: row.updated_at || row.created_at || null,
  };
}

/**
 * Évaluations de groupe par candidat, pour les candidats demandés.
 * Renvoie un objet vide plutôt qu'une erreur si la table n'existe pas encore :
 * la fiche candidat et la délibération doivent continuer de s'afficher.
 */
export async function getGroupEvaluationsByCandidate(
  candidateIds: string[],
): Promise<Record<string, GroupEvaluationView[]>> {
  const ids = Array.from(new Set(candidateIds.filter(Boolean)));
  if (ids.length === 0) return {};

  const { data: notes, error } = await fetchAllRows<any>((from, to) =>
    supabaseAdmin
      .from("group_evaluations")
      .select(
        "id, slot_id, comment, scores, updated_at, created_at, author:members!member_id(first_name, last_name, email), epreuve:epreuves(id, name, tour)",
      )
      .order("created_at")
      .range(from, to),
  );

  if (error) {
    if (!isMissingTable(error)) {
      console.error("[group-evaluations] lecture impossible:", error);
    }
    return {};
  }
  if (!notes || notes.length === 0) return {};

  const bySlot = new Map<string, GroupEvaluationView>();
  for (const row of notes) bySlot.set(row.slot_id, view(row));

  // Inscriptions des candidats demandés sur les créneaux notés.
  const { data: enrollments, error: enrollError } = await fetchAllRows<any>(
    (from, to) =>
      supabaseAdmin
        .from("slot_enrollments")
        .select("candidate_id, slot_id, status")
        .in("slot_id", Array.from(bySlot.keys()))
        .order("id")
        .range(from, to),
  );

  if (enrollError) {
    console.error("[group-evaluations] inscriptions illisibles:", enrollError);
    return {};
  }

  const wanted = new Set(ids);
  const out: Record<string, GroupEvaluationView[]> = {};
  for (const e of enrollments || []) {
    if (!wanted.has(e.candidate_id) || !isActiveEnrollment(e.status)) continue;
    const note = bySlot.get(e.slot_id);
    if (!note) continue;
    if (!out[e.candidate_id]) out[e.candidate_id] = [];
    out[e.candidate_id].push(note);
  }
  return out;
}
