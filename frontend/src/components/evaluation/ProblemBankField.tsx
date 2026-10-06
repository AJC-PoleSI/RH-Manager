"use client";

/**
 * ProblemBankField — critère « Réponse à la problématique » (Tour 3,
 * échange groupé). Le jury choisit la question posée au groupe (partagée par
 * les examinateurs du créneau, cf. /api/evaluations/slot-question), puis coche
 * les pistes citées ou défendues par SON candidat ; une piste pertinente non
 * listée compte aussi. Note = 1 point par piste, plafonnée au barème
 * (lib/problem-bank.ts). Le serveur recalcule la note à l'enregistrement.
 */

import {
  findProblemQuestion,
  problemScore,
  type ProblemBank,
} from "@/lib/problem-bank";
import {
  getCriterionHint,
  getCriterionLabel,
  type EvaluationCriterion,
} from "@/lib/evaluation-criteria";

export interface ProblemBankState {
  /** Question choisie pour le créneau (null tant que personne n'a choisi). */
  questionKey: string | null;
  /** Une note est déjà validée sur le créneau : la question ne bouge plus. */
  locked: boolean;
  loading: boolean;
  /** Message bloquant (migration en attente, candidat sans créneau…). */
  error: string | null;
}

export default function ProblemBankField({
  bank,
  criterion,
  state,
  saving,
  onSelectQuestion,
  checked,
  extra,
  onChecksChange,
  disabled,
}: {
  bank: ProblemBank;
  criterion: EvaluationCriterion;
  state: ProblemBankState;
  /** Enregistrement de la question en cours. */
  saving: boolean;
  onSelectQuestion: (key: string) => void;
  checked: number[];
  extra: number;
  onChecksChange: (checked: number[], extra: number) => void;
  disabled?: boolean;
}) {
  const question = findProblemQuestion(bank, state.questionKey);
  const score = question ? problemScore(checked.length, extra, bank.maxPoints) : 0;
  const hint = getCriterionHint(criterion);

  const togglePiste = (i: number) => {
    const next = checked.includes(i)
      ? checked.filter((x) => x !== i)
      : [...checked, i].sort((a, b) => a - b);
    onChecksChange(next, extra);
  };

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-800">{getCriterionLabel(criterion)}</p>
          {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
        </div>
        <p className="text-lg font-bold text-blue-700 whitespace-nowrap">
          {score}
          <span className="text-xs font-medium text-blue-400"> / {bank.maxPoints}</span>
        </p>
      </div>

      {state.error ? (
        <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          {state.error}
        </p>
      ) : (
        <>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-700">
              Question posée au groupe
            </label>
            <select
              className="w-full p-2 border rounded-md text-sm bg-white disabled:bg-gray-50"
              value={state.questionKey ?? ""}
              disabled={disabled || state.locked || saving || state.loading}
              onChange={(e) => e.target.value && onSelectQuestion(e.target.value)}
            >
              <option value="">— Choisir la question —</option>
              {bank.questions.map((q) => (
                <option key={q.key} value={q.key}>
                  {q.title}
                  {q.pole ? ` (${q.pole})` : ""}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500">
              {state.locked
                ? "🔒 Une note est déjà validée sur ce créneau : la question ne peut plus changer."
                : "Partagée avec les autres examinateurs du créneau : un seul choix pour tout le groupe."}
            </p>
          </div>

          {question ? (
            <>
              {question.prompt && (
                <p className="text-sm text-gray-800 bg-white border border-gray-200 rounded px-3 py-2 whitespace-pre-wrap">
                  {question.prompt}
                </p>
              )}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-gray-700">
                  Pistes citées ou défendues par le candidat (1 point chacune)
                </p>
                {question.pistes.map((piste, i) => {
                  const id = `piste-${question.key}-${i}`;
                  return (
                    <div key={id} className="flex items-start gap-2.5">
                      <input
                        id={id}
                        type="checkbox"
                        checked={checked.includes(i)}
                        disabled={disabled}
                        onChange={() => togglePiste(i)}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
                      />
                      <label htmlFor={id} className="text-sm text-gray-700 cursor-pointer">
                        {piste}
                      </label>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-blue-100 pt-2">
                <span className="text-sm text-gray-700">
                  Autre piste pertinente, non listée
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={disabled || extra <= 0}
                    onClick={() => onChecksChange(checked, Math.max(0, extra - 1))}
                    className="w-7 h-7 rounded-md border border-gray-300 bg-white text-gray-700 font-semibold disabled:opacity-40"
                    aria-label="Retirer une piste hors liste"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-sm font-semibold">{extra}</span>
                  <button
                    type="button"
                    disabled={disabled || extra >= bank.maxPoints}
                    onClick={() => onChecksChange(checked, Math.min(bank.maxPoints, extra + 1))}
                    className="w-7 h-7 rounded-md border border-gray-300 bg-white text-gray-700 font-semibold disabled:opacity-40"
                    aria-label="Ajouter une piste hors liste"
                  >
                    +
                  </button>
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-500 italic">
              {state.loading
                ? "Chargement de la question du créneau…"
                : "Choisissez la question pour afficher ses pistes."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
