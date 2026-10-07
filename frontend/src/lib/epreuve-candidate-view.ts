// Ce qu'un CANDIDAT a le droit de voir d'une épreuve.
//
// Constat du 07/10/2026 : GET /api/epreuves renvoyait aux candidats la grille
// de notation complète (`evaluationQuestions` : intitulés, barèmes,
// précisions) — seule la 2e grille était masquée. N'importe quel candidat la
// lisait dans l'onglet Réseau du navigateur. Avec la grille de l'épreuve de
// prospection (74 critères) et la banque de questions accompagnée des
// réponses attendues, la fuite deviendrait une fuite des corrigés.
//
// Règle unique, partagée par toutes les routes qu'un candidat peut appeler :
//   • aucun champ de notation ne sort, quel que soit son nom (camelCase pour
//     les objets déjà mis en forme par la route, snake_case pour les lignes
//     brutes jointes par `epreuves(*)`) ;
//   • la description (consignes de l'épreuve) n'est montrée qu'au candidat
//     INSCRIT à l'épreuve, planning ouvert aux candidats
//     (`system_settings.planning_visible_candidats`).
//
// Module pur (aucun import de supabase) : la route lit le réglage et les
// inscriptions, ce module applique la règle. Membres et admins ne passent
// jamais par ici.

import { filterActiveEnrollments } from "./enrollment";

/**
 * La description (consignes) d'une épreuve est-elle visible d'un candidat ?
 * Décision de Felix (07/10/2026, après-midi) : « réserve l'énoncé aux
 * inscrits » — le candidat découvre l'énoncé en s'inscrivant (ex. carte
 * blanche de l'entretien SI). Remplace la règle du matin (« dès qu'un
 * créneau de l'épreuve est publié »), qui le montrait à tous.
 *   - épreuve à créneaux : planning ouvert ET inscription active sur un
 *     créneau de CETTE épreuve ;
 *   - épreuve en distanciel : planning ouvert ET inscrit (sans créneau) ;
 *   - épreuve « sur table » (type commune, passée par tous sans
 *     inscription) : planning ouvert.
 */
export function candidateSeesDescription(o: {
  planningVisible: boolean;
  /** Épreuve « sur table » (type commune) : aucune inscription possible. */
  onTable: boolean;
  /** Inscription active à cette épreuve (créneau, ou distanciel). */
  enrolled: boolean;
}): boolean {
  if (!o.planningVisible) return false;
  return o.onTable || o.enrolled;
}

/** Épreuve « sur table » (type commune) ? (objet mis en forme OU ligne brute) */
export function isOnTableEpreuve(e: Record<string, any> | null | undefined): boolean {
  if (!e) return false;
  return e.isCommune === true || e.type === "commune";
}

/**
 * Épreuves auxquelles un candidat est inscrit : créneaux à inscription active
 * (cf. isActiveEnrollment — statut absent, `active` ou `enrolled`) et
 * inscriptions en distanciel. Une inscription annulée ne compte pas.
 */
export function enrolledEpreuveIds(
  enrollments: { status?: string | null; epreuveId?: string | null }[],
  registrations: { epreuveId?: string | null }[],
): Set<string> {
  const ids = new Set<string>();
  for (const e of enrollments) {
    if (filterActiveEnrollments(e) && e.epreuveId) ids.add(e.epreuveId);
  }
  for (const r of registrations) {
    if (r.epreuveId) ids.add(r.epreuveId);
  }
  return ids;
}

/** Champs de notation qu'un candidat ne doit JAMAIS recevoir. */
export const CANDIDATE_HIDDEN_EPREUVE_FIELDS = [
  // Grille de notation (critères, barèmes, précisions).
  "evaluationQuestions",
  "evaluation_questions",
  // Deuxième grille (ex. proposition commerciale).
  "secondaryGrid",
  "secondary_grid",
  // Banque de questions + pistes de réponse attendues.
  "problemBank",
  "problem_bank",
  // Grille de groupe (business game).
  "groupGrid",
  "group_grid",
] as const;

const HIDDEN = new Set<string>(CANDIDATE_HIDDEN_EPREUVE_FIELDS);

/**
 * Copie d'une épreuve (objet mis en forme OU ligne brute) telle qu'un
 * candidat peut la recevoir : sans aucun champ de notation, et sans
 * description quand `showDescription` est faux (cf. candidateSeesDescription).
 *
 * Les autres champs (coefficient, isDistanciel, isRegistered, couleur,
 * salle…) passent tels quels. `null` / `undefined` sont renvoyés inchangés
 * (jointure vide côté Supabase).
 */
export function epreuveForCandidate<T extends Record<string, any>>(
  epreuve: T,
  showDescription: boolean,
): Record<string, any>;
export function epreuveForCandidate(
  epreuve: null | undefined,
  showDescription: boolean,
): null | undefined;
export function epreuveForCandidate(
  epreuve: Record<string, any> | null | undefined,
  showDescription: boolean,
): Record<string, any> | null | undefined;
export function epreuveForCandidate(
  epreuve: Record<string, any> | null | undefined,
  showDescription: boolean,
): Record<string, any> | null | undefined {
  if (epreuve == null || typeof epreuve !== "object") return epreuve;

  const copy: Record<string, any> = {};
  for (const [key, value] of Object.entries(epreuve)) {
    if (HIDDEN.has(key)) continue;
    copy[key] = value;
  }
  // Consignes : seulement au candidat inscrit. On ne crée pas la clé si
  // l'objet ne la portait pas (jointure restreinte à quelques colonnes).
  if (!showDescription && "description" in copy) {
    copy.description = null;
  }
  return copy;
}
