// Source unique de vérité pour le BARÈME d'un critère d'évaluation.
//
// Un critère est stocké dans `epreuves.evaluation_questions` sous la forme
// `{ q: "Motivation", weight: 20 }`. `weight` porte le nombre de points
// MAXIMUM attribuables — ce n'est pas un coefficient multiplicateur.
//
// Historique : le formulaire d'administration appelait ce champ « Coeff. » et
// l'initialisait à 1, alors que POST /api/evaluations l'interprète comme un
// plafond. Toute épreuve créée avec les valeurs par défaut refusait donc les
// notes supérieures à 1 point. Les trois lectures de la valeur (formulaire,
// validation des notes, calcul de moyenne) passent désormais par ce module.

/** Barème par défaut quand le critère n'en déclare pas de valide. */
export const DEFAULT_MAX_POINTS = 20;

export interface EvaluationCriterion {
  q?: string;
  question?: string;
  name?: string;
  weight?: number | string;
  maxScore?: number | string;
  coefficient?: number | string;
}

/**
 * Nombre de points maximum d'un critère. Retombe sur DEFAULT_MAX_POINTS si la
 * valeur est absente, non numérique ou <= 0 — un barème nul ou négatif rendrait
 * l'épreuve impossible à noter.
 */
export function getMaxPoints(question: EvaluationCriterion | null | undefined): number {
  if (!question) return DEFAULT_MAX_POINTS;
  const declared = Number(
    question.weight ?? question.maxScore ?? question.coefficient,
  );
  return Number.isFinite(declared) && declared > 0 ? declared : DEFAULT_MAX_POINTS;
}

/** Libellé affichable d'un critère, quel que soit le nom de champ utilisé. */
export function getCriterionLabel(question: EvaluationCriterion | null | undefined): string {
  if (!question) return "";
  return question.q || question.question || question.name || "";
}

/**
 * Parse `epreuves.evaluation_questions`, qui peut être une chaîne JSON ou un
 * tableau déjà désérialisé. Renvoie toujours un tableau.
 */
export function parseQuestions(raw: unknown): EvaluationCriterion[] {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? (value as EvaluationCriterion[]) : [];
}

/**
 * Normalise une liste de critères avant écriture en base : chaque critère
 * ressort avec un `weight` numérique strictement positif.
 */
export function normalizeQuestions(raw: unknown): EvaluationCriterion[] {
  return parseQuestions(raw).map((q) => {
    if (!q || typeof q !== "object") return q;
    return { ...q, weight: getMaxPoints(q) };
  });
}

/** Total de points d'une épreuve, tous critères confondus. */
export function getTotalMaxPoints(raw: unknown): number {
  return parseQuestions(raw).reduce((sum, q) => sum + getMaxPoints(q), 0);
}
