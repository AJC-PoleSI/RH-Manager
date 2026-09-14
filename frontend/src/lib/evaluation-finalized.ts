/**
 * evaluation-finalized — « Ce candidat a-t-il DÉJÀ été évalué ? »
 *
 * Une ligne dans `candidate_evaluations` ne suffit pas à l'affirmer : le
 * formulaire d'évaluation en crée une dès l'ouverture, avant toute saisie.
 * Bloquer sur la seule présence de la ligne verrouillait définitivement le
 * candidat sur l'épreuve — le « ghost lock » corrigé à l'audit #4.
 *
 * Une évaluation ne compte que si elle porte VRAIMENT quelque chose : au
 * moins une note renseignée, ou un commentaire non vide.
 */

/** Une note compte-t-elle ? (ni nulle, ni vide, ni NaN) */
function isFilledScore(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return false;
  if (typeof v === "number" && Number.isNaN(v)) return false;
  return true;
}

/**
 * `scores` peut arriver en objet (jsonb) ou en chaîne JSON selon le client
 * Supabase et l'ancienneté de la ligne. Illisible → considéré comme vide.
 */
export function isFinalizedEvaluation(
  row: { scores?: unknown; comment?: unknown } | null | undefined,
): boolean {
  if (!row) return false;

  let hasScore = false;
  try {
    const parsed =
      typeof row.scores === "string" ? JSON.parse(row.scores) : row.scores;
    if (parsed && typeof parsed === "object") {
      hasScore = Object.values(parsed as Record<string, unknown>).some(isFilledScore);
    }
  } catch {
    hasScore = false;
  }

  const hasComment = !!(row.comment && String(row.comment).trim());
  return hasScore || hasComment;
}
