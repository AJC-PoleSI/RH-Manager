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

/**
 * Mode de saisie d'un critère (07/10/2026, notation du Tour 3) :
 *   - "number"       → saisie chiffrée, demi-points acceptés (historique) ;
 *   - "checkbox"     → une case à cocher : cochée = 1, décochée = 0 ;
 *   - "scale"        → boutons de 0 au barème du critère (entiers) ;
 *   - "problem_bank" → nombre de pistes cochées pour la question tirée de la
 *                      banque de l'épreuve (cf. lib/problem-bank.ts).
 * Un critère sans `input` reste une saisie chiffrée : rien ne change pour les
 * grilles existantes.
 */
export type CriterionInput = "number" | "checkbox" | "scale" | "problem_bank";

export interface EvaluationCriterion {
  q?: string;
  question?: string;
  name?: string;
  weight?: number | string;
  maxScore?: number | string;
  coefficient?: number | string;
  /** Précision affichée derrière le « i » de la grille de notation. */
  hint?: string;
  /** Mode de saisie ; absent = saisie chiffrée. */
  input?: CriterionInput | string;
  /** Titre de bloc, pour regrouper les critères à l'écran (facultatif). */
  section?: string;
}

/** Mode de saisie d'un critère ; toute valeur inconnue vaut "number". */
export function getCriterionInput(
  question: EvaluationCriterion | null | undefined,
): CriterionInput {
  const v = question?.input;
  return v === "checkbox" || v === "scale" || v === "problem_bank" ? v : "number";
}

/** Titre de bloc d'un critère (vide s'il n'en a pas). */
export function getCriterionSection(
  question: EvaluationCriterion | null | undefined,
): string {
  return typeof question?.section === "string" ? question.section.trim() : "";
}

/**
 * Parties (blocs `section`) d'une grille, dans l'ordre d'apparition. Les
 * critères sans bloc ne forment pas de partie.
 */
export function getCriterionSections(
  questions: EvaluationCriterion[] | null | undefined,
): string[] {
  const out: string[] = [];
  for (const q of questions ?? []) {
    const s = getCriterionSection(q);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Grille notée PARTIE PAR PARTIE (07/10/2026, demande de Felix pour
 * l'épreuve de prospection : « on évalue le mail, puis on revient pour
 * l'appel ») : au moins deux blocs. La note est alors enregistrée en
 * brouillon (non close) et ne se clôt qu'à la validation finale. Toute autre
 * grille garde le comportement historique : clôture à l'enregistrement.
 */
export function supportsDraftEvaluation(
  questions: EvaluationCriterion[] | null | undefined,
): boolean {
  return getCriterionSections(questions).length >= 2;
}

/** Une saisie à cocher n'accepte que des entiers (pas de demi-point). */
function requiresInteger(question: EvaluationCriterion | null | undefined): boolean {
  return getCriterionInput(question) !== "number";
}

/**
 * Nombre de points maximum d'un critère. Retombe sur DEFAULT_MAX_POINTS si la
 * valeur est absente, non numérique ou <= 0 — un barème nul ou négatif rendrait
 * l'épreuve impossible à noter.
 */
export function getMaxPoints(question: EvaluationCriterion | null | undefined): number {
  if (!question) return DEFAULT_MAX_POINTS;
  // Une case à cocher vaut toujours 1 point, quel que soit le `weight` stocké.
  if (getCriterionInput(question) === "checkbox") return 1;
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

/** Précision d'un critère (vide si le critère est assez explicite). */
export function getCriterionHint(question: EvaluationCriterion | null | undefined): string {
  return typeof question?.hint === "string" ? question.hint.trim() : "";
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
 * ressort avec un `weight` numérique strictement positif (1 pour une case à
 * cocher, cf. getMaxPoints). Les autres champs (`input`, `section`, `hint`…)
 * sont conservés tels quels.
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

/**
 * Coefficient d'une épreuve dans une moyenne pondérée, dérivé de son barème :
 * une épreuve notée sur 40 pèse coefficient 2, sur 5 pèse 0,25, sur 20 pèse 1.
 * Pas de champ dédié à gérer — le coefficient découle directement du barème.
 */
export function getEpreuveCoefficient(maxTotal: number): number {
  return Number.isFinite(maxTotal) && maxTotal > 0 ? maxTotal / 20 : 1;
}

/**
 * Coefficient choisi par l'admin (onglet Réglages → Coefficients, colonne
 * `epreuves.coefficient`) s'il est exploitable : nombre fini et > 0. Sinon
 * null — « automatique ». Accepte aussi une chaîne : une colonne NUMERIC peut
 * arriver sérialisée en texte selon le client.
 */
export function parseEpreuveCoefficient(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Poids EFFECTIF d'une épreuve dans une moyenne (07/10/2026) : le coefficient
 * choisi par l'admin s'il est valide, sinon le calcul historique dérivé du
 * barème (getEpreuveCoefficient). Coefficient absent, null, 0, négatif ou NaN
 * ⇒ exactement le comportement d'avant l'onglet Coefficients — c'est ce qui
 * garantit que les moyennes des tours 1 et 2 ne bougent pas.
 */
export function effectiveCoefficient(
  coef: number | null | undefined,
  maxTotal: number,
): number {
  return parseEpreuveCoefficient(coef) ?? getEpreuveCoefficient(maxTotal);
}

/** Convertit un total obtenu sur le barème d'une épreuve en note sur 20. */
export function toTwenty(obtained: number, maxTotal: number): number {
  if (!Number.isFinite(maxTotal) || maxTotal <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, obtained / maxTotal));
  return Math.round(ratio * 20 * 10) / 10;
}

// ── Notes saisies par un examinateur ─────────────────────────────────────
//
// Les notes sont stockées dans `candidate_evaluations.scores` sous la forme
// `{ "0": 3, "1": 2 }`, indexées par la POSITION du critère dans
// `epreuves.evaluation_questions`. Les deux routes d'écriture (POST et PUT
// /api/evaluations) passent par les deux fonctions ci-dessous — le PUT ne
// bornait auparavant rien du tout (audit du 12/09/2026).

/** Désérialise une saisie brute (objet ou chaîne JSON) ; jamais d'exception. */
function parseScores(raw: unknown): Record<string, unknown> {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Nombre maximum de décimales conservées sur une note (0,25 point près). */
export const SCORE_DECIMALS = 2;

/**
 * Lit une note saisie à la main. Les demi-points sont autorisés et la VIRGULE
 * française est acceptée au même titre que le point : « 3,5 » vaut 3.5.
 * `Number("3,5")` renvoie NaN — sans cette normalisation la note était
 * silencieusement écartée (« pas de note ») au lieu d'être enregistrée.
 *
 * Une case vide, ou non numérique, n'est PAS une note (et surtout pas 0).
 * Le résultat est arrondi au centième : une note n'a pas besoin de plus de
 * précision, et ça évite les 3.4000000000000004 dans les totaux.
 */
export function parseScoreInput(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const raw =
    typeof value === "string" ? value.trim().replace(",", ".") : value;
  if (raw === "") return null;
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  const factor = 10 ** SCORE_DECIMALS;
  return Math.round(num * factor) / factor;
}

/**
 * Frappe autorisée dans une case de note : des chiffres, un seul séparateur
 * décimal (virgule OU point) et au plus deux décimales. « 3,5 » et « 3, »
 * (saisie en cours) passent ; « 3,5,5 » et « abc » sont refusés.
 *
 * Sert à FILTRER la frappe, pas à la corriger : une saisie refusée n'est pas
 * réécrite, sinon « 3, » redeviendrait « 3 » avant que la décimale arrive.
 */
export function isScoreInput(value: string): boolean {
  return value === "" || /^\d*[.,]?\d{0,2}$/.test(value);
}

/**
 * Affiche une note à la française : séparateur virgule, décimales seulement
 * quand il y en a (3 → « 3 », 3.5 → « 3,5 »).
 */
export function formatScore(value: unknown): string {
  const num = parseScoreInput(value);
  if (num === null) return "";
  return num.toLocaleString("fr-FR", {
    maximumFractionDigits: SCORE_DECIMALS,
  });
}

const toScoreNumber = parseScoreInput;

/**
 * Normalise les notes avant écriture en base : uniquement des nombres finis,
 * et — quand les critères sont fournis — uniquement des clés qui
 * correspondent à un critère existant. Une case laissée vide est écartée
 * plutôt que stockée à 0 : « pas de note » n'est pas « zéro ».
 */
export function normalizeScores(
  raw: unknown,
  questions?: EvaluationCriterion[] | null,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(parseScores(raw))) {
    const num = toScoreNumber(value);
    if (num === null) continue;
    if (questions) {
      const idx = Number(key);
      if (!Number.isInteger(idx) || idx < 0 || idx >= questions.length) continue;
    }
    out[key] = num;
  }
  return out;
}

export interface ScoreValidationError {
  index: number;
  label: string;
  maxPoints: number;
  reason: "negative" | "above_max" | "not_integer";
}

/**
 * Vérifie que chaque note tient dans [0, points max du critère]. Renvoie la
 * première erreur rencontrée (dans l'ordre des critères), ou null. Les clés
 * sans critère et les cases vides sont ignorées (cf. normalizeScores).
 */
export function validateScores(
  questions: EvaluationCriterion[] | null | undefined,
  raw: unknown,
): ScoreValidationError | null {
  const criteria = questions ?? [];
  if (criteria.length === 0) return null;
  const scores = normalizeScores(raw, criteria);
  for (let index = 0; index < criteria.length; index++) {
    const value = scores[String(index)];
    if (value === undefined) continue;
    const question = criteria[index];
    const maxPoints = getMaxPoints(question);
    const label = getCriterionLabel(question);
    if (value < 0) return { index, label, maxPoints, reason: "negative" };
    if (value > maxPoints)
      return { index, label, maxPoints, reason: "above_max" };
    if (requiresInteger(question) && !Number.isInteger(value))
      return { index, label, maxPoints, reason: "not_integer" };
  }
  return null;
}

/** Message d'erreur utilisateur (français) pour une note hors barème. */
export function scoreValidationMessage(err: ScoreValidationError): string {
  const label = err.label || `critère n°${err.index + 1}`;
  if (err.reason === "not_integer")
    return `La note pour le critère "${label}" doit être un nombre entier.`;
  return err.reason === "negative"
    ? `La note pour le critère "${label}" ne peut pas être négative.`
    : `La note pour le critère "${label}" ne peut pas dépasser ${err.maxPoints} points.`;
}

// ── Moyenne d'un candidat : UNE règle pour tous les écrans ───────────────
//
// Délibération, fiche candidat, récapitulatif et export xlsx doivent afficher
// la même moyenne. Règle :
//   1. chaque évaluation est ramenée en % de réussite (obtenu / barème) ;
//   2. les évaluations d'une MÊME épreuve sont moyennées entre elles (deux
//      examinateurs ne comptent pas double) ;
//   3. chaque épreuve pèse ensuite au prorata de son barème
//      (getEpreuveCoefficient : /40 → coef 2, /5 → coef 0,25) — sauf si
//      l'admin a choisi un coefficient pour l'épreuve (07/10/2026, champ
//      `coef`, cf. effectiveCoefficient) ;
//   4. résultat sur 20, arrondi au dixième — `null` quand aucune note n'est
//      exploitable (à distinguer d'une vraie moyenne de 0).

/** Vrai si l'objet de notes contient au moins une valeur numérique. */
export function hasAnyScore(raw: unknown): boolean {
  return Object.keys(normalizeScores(raw)).length > 0;
}

/** Somme des notes d'une évaluation (valeurs numériques uniquement). */
export function sumScores(raw: unknown): number {
  return Object.values(normalizeScores(raw)).reduce((a, b) => a + b, 0);
}

export interface ScoredEvaluation {
  /** Identifiant de l'épreuve (ou à défaut son nom) — sert au regroupement. */
  epreuveKey: string;
  /** Total obtenu sur l'évaluation. */
  obtained: number;
  /** Total de points de l'épreuve (somme des barèmes de ses critères). */
  maxTotal: number;
  /**
   * Coefficient choisi par l'admin (`epreuves.coefficient`, 07/10/2026) ;
   * absent ou null = barème ÷ 20 (calcul historique).
   */
  coef?: number | null;
}

export function averageOn20ByEpreuve(
  items: ScoredEvaluation[],
): number | null {
  const byEpreuve = new Map<
    string,
    { ratios: number[]; maxTotal: number; coef: number | null }
  >();
  for (const it of items) {
    const maxTotal = Number(it.maxTotal);
    const obtained = Number(it.obtained);
    if (!Number.isFinite(maxTotal) || maxTotal <= 0) continue;
    if (!Number.isFinite(obtained)) continue;
    const entry = byEpreuve.get(it.epreuveKey) || {
      ratios: [],
      maxTotal,
      coef: null,
    };
    entry.ratios.push(Math.min(1, Math.max(0, obtained / maxTotal)));
    // Coefficient de l'épreuve : le premier valide rencontré parmi ses notes
    // (toutes portent normalement le même, celui de la ligne `epreuves`).
    if (entry.coef === null) entry.coef = parseEpreuveCoefficient(it.coef);
    byEpreuve.set(it.epreuveKey, entry);
  }
  if (byEpreuve.size === 0) return null;

  let weightedSum = 0;
  let totalCoef = 0;
  byEpreuve.forEach(({ ratios, maxTotal, coef: chosen }) => {
    const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    // Sans coefficient choisi : getEpreuveCoefficient(maxTotal), comme avant.
    const coef = effectiveCoefficient(chosen, maxTotal);
    weightedSum += avgRatio * coef;
    totalCoef += coef;
  });
  if (totalCoef <= 0) return null;
  return Math.round((weightedSum / totalCoef) * 20 * 10) / 10;
}
