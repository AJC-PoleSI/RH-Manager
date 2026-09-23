"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  formatScore,
  getCriterionHint,
  getCriterionLabel,
  getMaxPoints,
  isScoreInput,
  parseScoreInput,
  type EvaluationCriterion,
} from "@/lib/evaluation-criteria";

// Grille de saisie des notes, partagée par toutes les grilles de l'écran de
// notation (entretien, évaluation du groupe, deuxième grille).

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
function CriterionLabel({ question }: { question: Question }) {
  const [open, setOpen] = useState(false);
  const hint = getCriterionHint(question);
  return (
    <div>
      <div className="flex items-start gap-1.5">
        <Label>{getCriterionLabel(question)}</Label>
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

export function ScoreGrid({
  questions,
  scores,
  scoreErrors,
  onChange,
  disabled,
}: {
  questions: Question[];
  scores: Record<number, string>;
  scoreErrors: Record<number, string>;
  onChange: (idx: number, val: string, maxPoints: number) => void;
  disabled?: boolean;
}) {
  if (questions.length === 0) {
    return (
      <p className="text-sm text-gray-500 italic">
        Aucun critère défini pour cette épreuve.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">
        Les demi-points sont acceptés (ex. 3,5).
      </p>
      {questions.map((q, idx) => {
        const maxPoints = getMaxPoints(q);
        return (
          <div key={idx} className="space-y-1">
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
            {scoreErrors[idx] && (
              <p className="text-red-500 text-xs sm:text-right">
                {scoreErrors[idx]}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
