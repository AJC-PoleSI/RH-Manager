/**
 * problem-bank — banque de questions de l'échange groupé (Tour 3, épreuve de
 * prospection). Règles pures, partagées client/serveur.
 *
 * Pendant l'échange groupé, le jury pose UNE question parmi une banque,
 * choisie selon les appétences des candidats. Le critère « Réponse à la
 * problématique » de la grille (`input: "problem_bank"`) se note alors avec
 * les PISTES de cette question : 1 point par piste citée ou défendue, plus
 * les pistes pertinentes non listées, plafonné au barème du critère.
 *
 * Le barème du critère reste FIXE quelle que soit la question : la note
 * s'enregistre comme n'importe quelle autre (`candidate_evaluations.scores`,
 * à la position `criterionIndex`), donc moyennes, délibération et export ne
 * changent pas.
 *
 * Stockage : `epreuves.problem_bank` (JSONB, null = pas de banque),
 * question choisie par créneau dans `slot_questions`, détail des pistes
 * cochées dans `candidate_evaluations.problem_checks` (facultatif).
 * Migration : supabase-migration-tour3-notation.sql. Brief du 06/10/2026, F3.
 */
import {
  getCriterionInput,
  getMaxPoints,
  type EvaluationCriterion,
} from "@/lib/evaluation-criteria";

export interface ProblemQuestion {
  key: string;
  title: string;
  prompt: string;
  /** Pôles visés (indication pour le jury). */
  pole?: string;
  pistes: string[];
}

export interface ProblemBank {
  /** Position du critère « Réponse à la problématique » dans la grille. */
  criterionIndex: number;
  /** Barème de ce critère (8 au Tour 3). */
  maxPoints: number;
  questions: ProblemQuestion[];
}

/** Pistes cochées par un examinateur pour la question de son créneau. */
export interface ProblemChecks {
  questionKey: string;
  /** Indices des pistes cochées dans `question.pistes`. */
  checked: number[];
  /** Pistes pertinentes NON listées, ajoutées par le jury. */
  extra: number;
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const isPositiveInt = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n > 0;

/**
 * Lit `epreuves.problem_bank`. Toute valeur absente ou mal formée renvoie
 * null : l'épreuve se note alors comme avant, sans banque.
 */
export function parseProblemBank(raw: unknown): ProblemBank | null {
  const value = parseJson(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const criterionIndex = v.criterionIndex;
  if (
    typeof criterionIndex !== "number" ||
    !Number.isInteger(criterionIndex) ||
    criterionIndex < 0
  ) {
    return null;
  }
  if (!isPositiveInt(v.maxPoints)) return null;
  if (!Array.isArray(v.questions) || v.questions.length === 0) return null;

  const seen = new Set<string>();
  const questions: ProblemQuestion[] = [];
  for (const q of v.questions) {
    if (!q || typeof q !== "object") return null;
    const r = q as Record<string, unknown>;
    const key = typeof r.key === "string" ? r.key.trim() : "";
    if (!key || seen.has(key)) return null;
    seen.add(key);
    questions.push({
      key,
      title: typeof r.title === "string" ? r.title.trim() : key,
      prompt: typeof r.prompt === "string" ? r.prompt.trim() : "",
      ...(typeof r.pole === "string" && r.pole.trim() ? { pole: r.pole.trim() } : {}),
      pistes: Array.isArray(r.pistes)
        ? r.pistes
            .filter((p): p is string => typeof p === "string")
            .map((p) => p.trim())
            .filter(Boolean)
        : [],
    });
  }
  return { criterionIndex, maxPoints: v.maxPoints, questions };
}

/**
 * La banque vise-t-elle bien un critère « problem_bank » de la grille, au même
 * barème ? Sinon on l'ignore plutôt que d'écrire une note au mauvais endroit
 * (les notes sont indexées par POSITION du critère).
 */
export function bankMatchesGrid(
  bank: ProblemBank,
  questions: EvaluationCriterion[] | null | undefined,
): boolean {
  const criterion = (questions ?? [])[bank.criterionIndex];
  return (
    !!criterion &&
    getCriterionInput(criterion) === "problem_bank" &&
    getMaxPoints(criterion) === bank.maxPoints
  );
}

export function findProblemQuestion(
  bank: ProblemBank,
  key: string | null | undefined,
): ProblemQuestion | null {
  if (!key) return null;
  return bank.questions.find((q) => q.key === key) ?? null;
}

/** 1 point par piste (listée ou non), plafonné au barème. */
export function problemScore(
  checkedCount: number,
  extra: number,
  maxPoints: number,
): number {
  const a = Math.max(0, Math.floor(Number(checkedCount) || 0));
  const b = Math.max(0, Math.floor(Number(extra) || 0));
  return Math.min(a + b, Math.max(0, Math.floor(maxPoints)));
}

/**
 * Nettoie les pistes cochées envoyées par le client : question connue de la
 * banque, indices entiers valides et sans doublon, pistes hors liste bornées
 * entre 0 et le barème. Question inconnue → null.
 */
export function normalizeProblemChecks(
  bank: ProblemBank,
  raw: unknown,
): ProblemChecks | null {
  const value = parseJson(raw);
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const question = findProblemQuestion(
    bank,
    typeof r.questionKey === "string" ? r.questionKey : null,
  );
  if (!question) return null;
  const checked = Array.from(
    new Set(
      (Array.isArray(r.checked) ? r.checked : []).filter(
        (i): i is number =>
          typeof i === "number" &&
          Number.isInteger(i) &&
          i >= 0 &&
          i < question.pistes.length,
      ),
    ),
  ).sort((a, b) => a - b);
  const extraRaw = Math.floor(Number(r.extra) || 0);
  const extra = Math.min(Math.max(0, extraRaw), bank.maxPoints);
  return { questionKey: question.key, checked, extra };
}

/** Note du critère « Réponse à la problématique » pour ces pistes cochées. */
export function scoreFromChecks(bank: ProblemBank, checks: ProblemChecks): number {
  return problemScore(checks.checked.length, checks.extra, bank.maxPoints);
}
