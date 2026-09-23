import { supabaseAdmin } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/supabase-paging";
import {
  getTotalMaxPoints,
  normalizeQuestions,
  normalizeScores,
  parseQuestions,
  sumScores,
  type EvaluationCriterion,
} from "@/lib/evaluation-criteria";

/**
 * DEUXIÈME GRILLE d'une épreuve — ex. la proposition commerciale que le
 * candidat envoie dans les 24 h qui suivent son rendez-vous client.
 *
 * Elle se note APRÈS l'entretien, souvent le lendemain, alors que la note de
 * l'entretien est déjà close. D'où un stockage à part :
 *   • la grille : `epreuves.secondary_grid` = { title, questions } (mêmes
 *     critères que `evaluation_questions` : { q, weight, hint? }) ;
 *   • les notes : `secondary_evaluations`, UNE ligne par (candidat, épreuve),
 *     modifiable à tout moment par n'importe quel examinateur du créneau
 *     (et par un admin) — pas de verrou « premier arrivé ».
 *
 * Dans les moyennes, elle compte comme une épreuve à part entière, pesée par
 * son barème (cf. averageOn20ByEpreuve) : clé `${epreuveId}:second`. Tant
 * qu'elle n'est pas notée, elle ne pèse rien (« pas de note » n'est pas 0).
 */

export const DEFAULT_SECOND_GRID_TITLE = "Deuxième grille";

export interface SecondGrid {
  title: string;
  questions: EvaluationCriterion[];
}

/** Lit `epreuves.secondary_grid` ; null si absente ou sans aucun critère. */
export function parseSecondGrid(raw: unknown): SecondGrid | null {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as { title?: unknown; questions?: unknown };
  const questions = parseQuestions(v.questions).filter(
    (q) => q && typeof q === "object",
  );
  if (questions.length === 0) return null;
  const title =
    typeof v.title === "string" && v.title.trim()
      ? v.title.trim()
      : DEFAULT_SECOND_GRID_TITLE;
  return { title, questions };
}

/**
 * Normalise une grille reçue du formulaire d'administration avant écriture.
 * Renvoie null (= pas de deuxième grille) si aucun critère n'a de libellé.
 */
export function normalizeSecondGrid(raw: unknown): SecondGrid | null {
  const parsed = parseSecondGrid(raw);
  if (!parsed) return null;
  const questions = normalizeQuestions(parsed.questions).filter(
    (q) => typeof q.q === "string" && q.q.trim() !== "",
  );
  if (questions.length === 0) return null;
  return { title: parsed.title, questions };
}

/** Clé d'épreuve de la deuxième grille dans les moyennes et les listes. */
export function secondGridKey(epreuveId: string): string {
  return `${epreuveId}:second`;
}

/** Table ou colonne absente : migration second-grid pas encore appliquée. */
export function isSecondGridMigrationMissing(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = String((err as { code?: unknown }).code ?? "");
  return (
    code === "PGRST205" || // table inconnue du cache PostgREST
    code === "42P01" || // undefined_table
    code === "PGRST204" || // colonne inconnue du cache PostgREST
    code === "42703" // undefined_column
  );
}

/**
 * Note de deuxième grille, mise en forme comme une évaluation ordinaire pour
 * que la délibération et la fiche candidat la listent et la moyennent sans
 * code spécifique.
 */
export interface SecondGridEvaluationView {
  id: string;
  isSecondGrid: true;
  scores: Record<string, number>;
  scoreTotal: number;
  maxTotal: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string | null;
  member: { email: string; firstName: string; lastName: string } | null;
  epreuve: {
    id: string;
    /** Épreuve d'origine (celle du rendez-vous). */
    parentId: string;
    name: string;
    tour: number | null;
    type: string | null;
    maxTotal: number;
    evaluationQuestions: EvaluationCriterion[];
  };
}

/**
 * Notes de deuxième grille des candidats demandés, indexées par candidat.
 * Objet vide si la migration n'est pas appliquée : la délibération et la
 * fiche candidat doivent continuer de s'afficher.
 */
export async function getSecondGridEvaluationsByCandidate(
  candidateIds: string[],
): Promise<Record<string, SecondGridEvaluationView[]>> {
  const ids = Array.from(new Set(candidateIds.filter(Boolean)));
  if (ids.length === 0) return {};

  const { data, error } = await fetchAllRows<any>((from, to) =>
    supabaseAdmin
      .from("secondary_evaluations")
      .select(
        "id, candidate_id, scores, comment, created_at, updated_at, editor:members!last_edited_by(email, first_name, last_name), epreuve:epreuves(id, name, tour, type, secondary_grid)",
      )
      .order("created_at")
      .range(from, to),
  );

  if (error) {
    if (!isSecondGridMigrationMissing(error)) {
      console.error("[second-grid] lecture impossible:", error);
    }
    return {};
  }

  const wanted = new Set(ids);
  const out: Record<string, SecondGridEvaluationView[]> = {};
  for (const row of data || []) {
    if (!wanted.has(row.candidate_id) || !row.epreuve) continue;
    const grid = parseSecondGrid(row.epreuve.secondary_grid);
    // Grille supprimée depuis : la note n'a plus de barème, on l'ignore.
    if (!grid) continue;
    const scores = normalizeScores(row.scores, grid.questions);
    if (Object.keys(scores).length === 0) continue;
    const maxTotal = getTotalMaxPoints(grid.questions);
    const editor = row.editor;
    const view: SecondGridEvaluationView = {
      id: row.id,
      isSecondGrid: true,
      scores,
      scoreTotal: sumScores(scores),
      maxTotal,
      comment: row.comment || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at || null,
      member: editor
        ? {
            email: editor.email,
            firstName: editor.first_name || "",
            lastName: editor.last_name || "",
          }
        : null,
      epreuve: {
        id: secondGridKey(row.epreuve.id),
        parentId: row.epreuve.id,
        name: `${String(row.epreuve.name || "").trim()} — ${grid.title}`,
        tour: row.epreuve.tour ?? null,
        type: row.epreuve.type ?? null,
        maxTotal,
        evaluationQuestions: grid.questions,
      },
    };
    (out[row.candidate_id] ||= []).push(view);
  }
  return out;
}
