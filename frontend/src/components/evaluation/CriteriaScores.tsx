import {
  formatScore,
  getCriterionLabel,
  getMaxPoints,
  parseQuestions,
} from "@/lib/evaluation-criteria";

/**
 * Détail d'une évaluation, critère par critère, avec le VRAI libellé du
 * critère (« Tenue correcte 3 / 3 ») plutôt que « Critère 1 ». Les notes sont
 * indexées par position dans la grille de l'épreuve (cf. evaluation-criteria).
 * Sans grille connue, on retombe sur le numéro du critère.
 */
export default function CriteriaScores({
  questions,
  scores,
  className = "",
}: {
  /** Critères de l'épreuve (tableau ou chaîne JSON `evaluation_questions`). */
  questions: unknown;
  scores: Record<string, unknown> | null | undefined;
  className?: string;
}) {
  const criteria = parseQuestions(questions);
  const entries = Object.entries(scores || {})
    .filter(([, v]) => formatScore(v) !== "")
    .sort(([a], [b]) => Number(a) - Number(b));
  if (entries.length === 0) return null;

  return (
    <div className={`space-y-1 ${className}`}>
      {entries.map(([key, value]) => {
        const q = criteria[Number(key)];
        const label = getCriterionLabel(q) || `Critère ${Number(key) + 1}`;
        return (
          <div
            key={key}
            className="flex items-start justify-between gap-3 text-sm"
          >
            <span className="text-gray-600">{label}</span>
            <span className="shrink-0 font-medium text-gray-800 bg-gray-50 px-2 py-0.5 rounded text-xs whitespace-nowrap">
              {formatScore(value)}
              {q ? (
                <span className="text-gray-400"> / {getMaxPoints(q)}</span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
