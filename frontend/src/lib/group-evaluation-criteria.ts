// Grille d'ÉVALUATION DU GROUPE — épreuves de groupe (business games).
//
// Historique : une épreuve de groupe portait DEUX notes par candidat, l'avis
// individuel de chaque examinateur et une « note collective » partagée,
// co-éditée en temps réel par tous les examinateurs du créneau et calculée
// sur les MÊMES critères que l'avis individuel. Elle comptait dans la moyenne
// du candidat, ce qui faisait peser deux fois la même grille.
//
// Depuis le 15/09/2026 : la note partagée disparaît. Un seul examinateur du
// créneau (en pratique le dernier) note LE GROUPE — pas un candidat — sur la
// grille ci-dessous. Elle est stockée par CRÉNEAU (table `group_evaluations`)
// et n'entre PAS dans la moyenne des candidats : c'est un éclairage pour la
// délibération.

import {
  getTotalMaxPoints,
  type EvaluationCriterion,
} from "@/lib/evaluation-criteria";

/**
 * Les 9 critères de l'évaluation du groupe. `weight` = points MAXIMUM du
 * critère (cf. lib/evaluation-criteria) : 8 critères sur 5, le bonus/malus
 * sur 3 — total 43 points.
 */
export const GROUP_EVALUATION_QUESTIONS: EvaluationCriterion[] = [
  { q: "Entraide", weight: 5 },
  { q: "Temps", weight: 5 },
  { q: "Aboutissement", weight: 5 },
  { q: "Clarté du projet", weight: 5 },
  { q: "Budget", weight: 5 },
  { q: "Présentation", weight: 5 },
  { q: "Faisabilité", weight: 5 },
  { q: "Ambiance de groupe", weight: 5 },
  { q: "Bonus ou malus", weight: 3 },
];

/** Total de points de la grille de groupe (43). */
export const GROUP_EVALUATION_MAX = getTotalMaxPoints(
  GROUP_EVALUATION_QUESTIONS,
);

/**
 * Vrai pour une ANCIENNE note collective : une ligne partagée
 * (`candidate_evaluations.is_group = true`) posée sur une épreuve « de
 * groupe ». Ces lignes ne sont plus créées, mais celles déjà en base ne
 * doivent plus peser dans la moyenne du candidat — l'une d'elles est une
 * grille entièrement à 0 qui écrasait sa note.
 *
 * ⚠ Ne concerne PAS la note partagée d'un binôme sur une épreuve
 * individuelle (`is_group = true` mais `is_group_epreuve = false`), qui reste
 * une vraie note et continue de compter.
 */
export function isLegacyCollectiveNote(ev: {
  is_group?: boolean | null;
  isGroup?: boolean | null;
  epreuves?: { is_group_epreuve?: boolean | null } | null;
}): boolean {
  const shared = ev.is_group === true || ev.isGroup === true;
  return shared && ev.epreuves?.is_group_epreuve === true;
}
