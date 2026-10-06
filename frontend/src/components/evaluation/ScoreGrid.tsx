"use client";

import { Fragment, useId, useState, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  formatScore,
  getCriterionHint,
  getCriterionInput,
  getCriterionLabel,
  getCriterionSection,
  getMaxPoints,
  isScoreInput,
  parseScoreInput,
  type EvaluationCriterion,
} from "@/lib/evaluation-criteria";

// Grille de saisie des notes, partagée par toutes les grilles de l'écran de
// notation (entretien, évaluation du groupe, deuxième grille).
//
// Modes de saisie (07/10/2026, cf. getCriterionInput) : saisie chiffrée
// (historique), case à cocher (1 point), échelle de 0 au barème, et critère
// « problem_bank » rendu par l'appelant (`renderCustom`). Les critères
// peuvent être regroupés en blocs titrés (`section`), avec leur sous-total.

/** Au-delà, une échelle de boutons devient illisible : saisie chiffrée. */
const MAX_SCALE_BUTTONS = 10;

type Question = EvaluationCriterion;

/**
 * Fusionne les notes renvoyées par le serveur avec la saisie déjà à l'écran.
 * Une case dont le texte local vaut DÉJÀ la même note est laissée intacte :
 * sans ça, « 3, » (décimale pas encore tapée, enregistrée comme 3) revenait
 * en « 3 » au rafraîchissement suivant et la frappe du « 5 » donnait « 35 ».
 */
export function mergeScores(
  local: Record<number, string>,
  incoming: Record<string, unknown>,
): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [key, value] of Object.entries(incoming || {})) {
    const idx = Number(key);
    const localVal = local[idx];
    out[idx] =
      localVal !== undefined &&
      parseScoreInput(localVal) === parseScoreInput(value)
        ? localVal
        : formatScore(value);
  }
  return out;
}

/** Libellé d'un critère, suivi d'un « i » qui déplie sa précision s'il en a une. */
function CriterionLabel({
  question,
  htmlFor,
}: {
  question: Question;
  /** Case à cocher associée : cliquer le libellé la coche. */
  htmlFor?: string;
}) {
  const [open, setOpen] = useState(false);
  const hint = getCriterionHint(question);
  return (
    <div>
      <div className="flex items-start gap-1.5">
        <Label htmlFor={htmlFor} className={htmlFor ? "cursor-pointer" : undefined}>
          {getCriterionLabel(question)}
        </Label>
        {hint && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Précision sur ce critère"
            aria-expanded={open}
            className={`shrink-0 w-4 h-4 mt-0.5 rounded-full border text-[10px] font-semibold italic leading-none flex items-center justify-center ${
              open
                ? "bg-blue-600 border-blue-600 text-white"
                : "border-gray-400 text-gray-500 hover:border-blue-500 hover:text-blue-600"
            }`}
          >
            i
          </button>
        )}
      </div>
      {hint && open && (
        <p className="mt-1 text-xs text-gray-600 bg-blue-50 border border-blue-100 rounded px-2 py-1.5">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Sous-total et barème d'un bloc (`section`) de la grille. */
function sectionTotals(
  questions: Question[],
  scores: Record<number, string>,
  section: string,
): { obtained: number; max: number } {
  let obtained = 0;
  let max = 0;
  questions.forEach((q, idx) => {
    if (getCriterionSection(q) !== section) return;
    max += getMaxPoints(q);
    obtained += parseScoreInput(scores[idx]) ?? 0;
  });
  return { obtained, max };
}

export function ScoreGrid({
  questions,
  scores,
  scoreErrors,
  onChange,
  disabled,
  renderCustom,
}: {
  questions: Question[];
  scores: Record<number, string>;
  scoreErrors: Record<number, string>;
  onChange: (idx: number, val: string, maxPoints: number) => void;
  disabled?: boolean;
  /**
   * Rendu d'un critère spécial (`input: "problem_bank"`) par l'appelant.
   * Renvoyer null retombe sur la saisie chiffrée.
   */
  renderCustom?: (question: Question, idx: number) => ReactNode | null;
}) {
  // Plusieurs grilles peuvent cohabiter sur la page : préfixe unique pour que
  // le libellé d'une case ne coche jamais celle d'une autre grille.
  const uid = useId();
  if (questions.length === 0) {
    return (
      <p className="text-sm text-gray-500 italic">
        Aucun critère défini pour cette épreuve.
      </p>
    );
  }
  const hasNumberInput = questions.some((q) => {
    const input = getCriterionInput(q);
    return (
      input === "number" ||
      (input === "scale" && getMaxPoints(q) > MAX_SCALE_BUTTONS)
    );
  });
  return (
    <div className="space-y-4">
      {hasNumberInput && (
        <p className="text-xs text-gray-400">
          Les demi-points sont acceptés (ex. 3,5).
        </p>
      )}
      {questions.map((q, idx) => {
        const maxPoints = getMaxPoints(q);
        const input = getCriterionInput(q);
        const section = getCriterionSection(q);
        const startsSection =
          !!section &&
          (idx === 0 || getCriterionSection(questions[idx - 1]) !== section);
        const totals = startsSection
          ? sectionTotals(questions, scores, section)
          : null;
        const custom =
          input === "problem_bank" && renderCustom ? renderCustom(q, idx) : null;
        const checkboxId = `${uid}-critere-${idx}`;

        let row: ReactNode;
        if (custom) {
          row = custom;
        } else if (input === "checkbox") {
          const checked = parseScoreInput(scores[idx]) === 1;
          row = (
            <div className="flex items-start gap-3">
              <input
                id={checkboxId}
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(e) => onChange(idx, e.target.checked ? "1" : "0", 1)}
                className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
              />
              <div className="flex-1">
                <CriterionLabel question={q} htmlFor={checkboxId} />
              </div>
            </div>
          );
        } else if (input === "scale" && maxPoints <= MAX_SCALE_BUTTONS) {
          const current = parseScoreInput(scores[idx]);
          row = (
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-center">
              <CriterionLabel question={q} />
              <div className="flex items-center gap-1 flex-wrap" role="radiogroup">
                {Array.from({ length: maxPoints + 1 }, (_, n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={current === n}
                    disabled={disabled}
                    onClick={() => onChange(idx, String(n), maxPoints)}
                    className={`w-8 h-8 rounded-md border text-sm font-semibold transition-colors disabled:opacity-60 ${
                      current === n
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "bg-white border-gray-300 text-gray-700 hover:border-blue-400"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          );
        } else {
          row = (
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-4 items-center">
              <CriterionLabel question={q} />
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  disabled={disabled}
                  value={scores[idx] ?? ""}
                  className={scoreErrors[idx] ? "border-red-500" : ""}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\s/g, "");
                    if (!isScoreInput(val)) return;
                    onChange(idx, val, maxPoints);
                  }}
                />
                <span className="text-sm text-gray-500 whitespace-nowrap font-medium">
                  / {maxPoints}
                </span>
              </div>
            </div>
          );
        }

        return (
          <Fragment key={idx}>
            {startsSection && totals && (
              <div className="flex items-baseline justify-between border-b border-gray-200 pt-3 pb-1">
                <h4 className="text-sm font-semibold text-gray-900">{section}</h4>
                <span className="text-xs font-semibold text-gray-500">
                  {formatScore(totals.obtained) || "0"} / {totals.max}
                </span>
              </div>
            )}
            <div className="space-y-1">
              {row}
              {scoreErrors[idx] && (
                <p className="text-red-500 text-xs sm:text-right">
                  {scoreErrors[idx]}
                </p>
              )}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
