// examiner-stats — ce que chaque examinateur a réellement noté, et à quel
// barème il note.
//
// DEUX questions distinctes, longtemps mélangées dans le tableau admin :
//
//  1. COMBIEN de candidats a-t-il évalués ? Une note partagée (binôme sur un
//     entretien) compte pour ses deux examinateurs — c'est voulu. Mais une
//     ANCIENNE note collective de business game (une ligne par candidat du
//     groupe, cf. lib/group-evaluation-criteria) gonflait le compte : un
//     examinateur ayant noté 2 candidats en affichait 4. Ces lignes ne
//     comptent plus comme des candidats évalués ; elles sont dénombrées à
//     part, une seule fois par épreuve.
//
//  2. À QUEL BARÈME note-t-il ? Deux examinateurs qui voient les mêmes
//     candidats ne mettent pas les mêmes notes : l'un plafonne à 13, l'autre
//     part de 17. On compare donc chaque examinateur aux AUTRES sur LES MÊMES
//     épreuves, et on en tire un coefficient indicatif — jamais appliqué
//     automatiquement aux notes, il éclaire la délibération.

/** Une évaluation, vue du décompte des examinateurs. */
export interface ExaminerEvaluationInput {
  /** Identifiant de l'évaluation : une note partagée reste UNE évaluation. */
  id: string;
  /** Tous les examinateurs crédités (auteur + co-examinateurs du créneau). */
  examinerIds: string[];
  /** Regroupement par épreuve : son id, à défaut « nom · tour ». */
  epreuveKey: string;
  /** Note ramenée sur 20, ou `null` si la grille est restée vide. */
  scoreOn20: number | null;
  /** Ancienne note collective d'une épreuve de groupe (business game). */
  isCollective: boolean;
}

export type ExaminerTendency = "severe" | "neutre" | "genereux";

export interface ExaminerStats {
  /** Candidats évalués : notes individuelles et partagées, collectives exclues. */
  evaluations: number;
  /** Anciennes notes collectives, comptées une fois par épreuve (pas par candidat). */
  collectiveNotes: number;
  /** Évaluations réellement notées (grille non vide) — base des moyennes. */
  scored: number;
  /** Moyenne /20 de ses notes, toutes épreuves confondues. */
  average: number | null;
  /** Note la plus basse / la plus haute, et leur écart (repère « il met toujours 17 »). */
  min: number | null;
  max: number | null;
  spread: number | null;
  /** Moyenne des AUTRES examinateurs sur les mêmes épreuves. */
  reference: number | null;
  /** Sa moyenne sur ces mêmes épreuves, moins la référence (en points /20). */
  deviation: number | null;
  /** Facteur ramenant sa moyenne à celle des autres (référence / sa moyenne). */
  coefficient: number | null;
  tendency: ExaminerTendency | null;
  /** Faux tant qu'il n'a pas assez noté pour que le barème veuille dire quelque chose. */
  reliable: boolean;
}

/** En dessous, un « barème » ne dirait rien : trop peu de notes. */
export const MIN_SCORES_FOR_CALIBRATION = 3;

/** Écart (en points /20) à partir duquel on qualifie un examinateur. */
export const TENDENCY_THRESHOLD = 0.75;

/**
 * Bornes du coefficient. Un examinateur qui n'a vu que des candidats faibles
 * afficherait sinon un facteur délirant sur 3 notes — le coefficient est un
 * repère, pas un correctif automatique.
 */
export const COEFFICIENT_MIN = 0.8;
export const COEFFICIENT_MAX = 1.25;

const EMPTY: ExaminerStats = {
  evaluations: 0,
  collectiveNotes: 0,
  scored: 0,
  average: null,
  min: null,
  max: null,
  spread: null,
  reference: null,
  deviation: null,
  coefficient: null,
  tendency: null,
  reliable: false,
};

/** Statistiques d'un examinateur absent du jeu de données (aucune note). */
export function emptyExaminerStats(): ExaminerStats {
  return { ...EMPTY };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Décompte + barème de chaque examinateur crédité dans `items`.
 *
 * Une évaluation n'est comptée qu'UNE fois par examinateur, même si elle
 * apparaît plusieurs fois dans l'entrée (id identique). La référence d'un
 * examinateur exclut toutes les évaluations dont il est crédité — sans quoi
 * sa propre note lui reviendrait via son binôme, qui porte la même note.
 */
export function computeExaminerStats(
  items: ExaminerEvaluationInput[],
): Record<string, ExaminerStats> {
  // ── Dédoublonnage : une évaluation = une ligne, quels que soient les
  // doublons d'entrée (récap admin + suivi des co-examinateurs).
  const byId = new Map<string, ExaminerEvaluationInput>();
  for (const item of items) {
    if (!item?.id) continue;
    const previous = byId.get(item.id);
    if (!previous) {
      byId.set(item.id, {
        ...item,
        examinerIds: Array.from(new Set(item.examinerIds.filter(Boolean))),
      });
      continue;
    }
    previous.examinerIds = Array.from(
      new Set([...previous.examinerIds, ...item.examinerIds.filter(Boolean)]),
    );
  }
  const evaluations = Array.from(byId.values());

  // ── Notes par épreuve (collectives exclues : elles ne notent personne).
  const scoredByEpreuve = new Map<string, ExaminerEvaluationInput[]>();
  for (const ev of evaluations) {
    if (ev.isCollective || ev.scoreOn20 === null) continue;
    const list = scoredByEpreuve.get(ev.epreuveKey) || [];
    list.push(ev);
    scoredByEpreuve.set(ev.epreuveKey, list);
  }

  const out: Record<string, ExaminerStats> = {};
  const ensure = (id: string): ExaminerStats =>
    (out[id] = out[id] || emptyExaminerStats());

  // ── Décomptes bruts ──
  const collectiveEpreuves: Record<string, Set<string>> = {};
  const scoresByExaminer: Record<string, number[]> = {};
  const scoresByExaminerEpreuve: Record<string, Map<string, number[]>> = {};

  for (const ev of evaluations) {
    for (const examinerId of ev.examinerIds) {
      const stats = ensure(examinerId);
      if (ev.isCollective) {
        // Une seule note de groupe par épreuve, quel que soit le nombre de
        // candidats du groupe : elle ne décrit pas une personne.
        if (!collectiveEpreuves[examinerId])
          collectiveEpreuves[examinerId] = new Set();
        collectiveEpreuves[examinerId].add(ev.epreuveKey);
        continue;
      }
      stats.evaluations += 1;
      if (ev.scoreOn20 === null) continue;
      stats.scored += 1;
      if (!scoresByExaminer[examinerId]) scoresByExaminer[examinerId] = [];
      scoresByExaminer[examinerId].push(ev.scoreOn20);
      if (!scoresByExaminerEpreuve[examinerId])
        scoresByExaminerEpreuve[examinerId] = new Map();
      const perEpreuve = scoresByExaminerEpreuve[examinerId];
      const list = perEpreuve.get(ev.epreuveKey) || [];
      list.push(ev.scoreOn20);
      perEpreuve.set(ev.epreuveKey, list);
    }
  }

  for (const [examinerId, epreuves] of Object.entries(collectiveEpreuves)) {
    ensure(examinerId).collectiveNotes = epreuves.size;
  }

  // ── Moyenne, amplitude, puis comparaison aux autres ──
  for (const [examinerId, scores] of Object.entries(scoresByExaminer)) {
    const stats = ensure(examinerId);
    stats.average = round1(mean(scores));
    stats.min = round1(Math.min(...scores));
    stats.max = round1(Math.max(...scores));
    stats.spread = round1(stats.max - stats.min);

    // Référence : moyenne des autres examinateurs, épreuve par épreuve,
    // pondérée par le nombre de notes qu'il y a lui-même posées. Comparer
    // des moyennes brutes mélangerait des épreuves de difficulté différente.
    let ownWeighted = 0;
    let refWeighted = 0;
    let weight = 0;
    const perEpreuve = scoresByExaminerEpreuve[examinerId];
    perEpreuve.forEach((ownScores, epreuveKey) => {
      const others = (scoredByEpreuve.get(epreuveKey) || []).filter(
        (ev) => !ev.examinerIds.includes(examinerId),
      );
      if (others.length === 0) return; // seul sur l'épreuve : rien à comparer
      const n = ownScores.length;
      ownWeighted += mean(ownScores) * n;
      refWeighted += mean(others.map((ev) => ev.scoreOn20 as number)) * n;
      weight += n;
    });

    if (weight === 0) continue;

    const ownComparable = ownWeighted / weight;
    const reference = refWeighted / weight;
    stats.reference = round1(reference);
    stats.deviation = round1(ownComparable - reference);
    stats.reliable = scores.length >= MIN_SCORES_FOR_CALIBRATION;

    if (ownComparable > 0) {
      const raw = reference / ownComparable;
      stats.coefficient =
        Math.round(
          Math.min(COEFFICIENT_MAX, Math.max(COEFFICIENT_MIN, raw)) * 100,
        ) / 100;
    }

    stats.tendency =
      stats.deviation <= -TENDENCY_THRESHOLD
        ? "severe"
        : stats.deviation >= TENDENCY_THRESHOLD
          ? "genereux"
          : "neutre";
  }

  return out;
}

/** Libellé court du barème d'un examinateur. */
export function tendencyLabel(tendency: ExaminerTendency): string {
  if (tendency === "severe") return "sévère";
  if (tendency === "genereux") return "généreux";
  return "dans la moyenne";
}
