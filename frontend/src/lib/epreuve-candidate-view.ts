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
//   • la description (consignes de l'épreuve) n'est montrée qu'une fois le
//     planning ouvert aux candidats (`system_settings.planning_visible_candidats`).
//
// Module pur (aucun import de supabase) : la route lit le réglage, ce module
// applique la règle. Membres et admins ne passent jamais par ici.

/**
 * La description (consignes) d'une épreuve est-elle visible d'un candidat ?
 * Décision de Felix (07/10/2026) : « uniquement quand les créneaux sont
 * dispo ». Le réglage global du planning ne suffit pas (il reste ouvert d'un
 * tour à l'autre) :
 *   - épreuve à créneaux : planning ouvert ET au moins un créneau publié
 *     (statut `published` ou `full`) pour CETTE épreuve ;
 *   - épreuve sans créneau (en distanciel, ou « sur table ») : planning ouvert.
 */
export function candidateSeesDescription(o: {
  planningVisible: boolean;
  /** Épreuve sans créneau : distanciel ou type « commune » (sur table). */
  slotless: boolean;
  /** Au moins un créneau publié pour cette épreuve. */
  hasPublishedSlot: boolean;
}): boolean {
  if (!o.planningVisible) return false;
  return o.slotless || o.hasPublishedSlot;
}

/** Épreuve sans créneau ? (objet mis en forme OU ligne brute) */
export function isSlotlessEpreuve(e: Record<string, any> | null | undefined): boolean {
  if (!e) return false;
  return (
    e.isDistanciel === true ||
    e.is_distanciel === true ||
    e.isCommune === true ||
    e.type === "commune"
  );
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
 * description tant que le planning n'est pas ouvert aux candidats.
 *
 * Les autres champs (coefficient, isDistanciel, isRegistered, couleur,
 * salle…) passent tels quels. `null` / `undefined` sont renvoyés inchangés
 * (jointure vide côté Supabase).
 */
export function epreuveForCandidate<T extends Record<string, any>>(
  epreuve: T,
  planningVisible: boolean,
): Record<string, any>;
export function epreuveForCandidate(
  epreuve: null | undefined,
  planningVisible: boolean,
): null | undefined;
export function epreuveForCandidate(
  epreuve: Record<string, any> | null | undefined,
  planningVisible: boolean,
): Record<string, any> | null | undefined;
export function epreuveForCandidate(
  epreuve: Record<string, any> | null | undefined,
  planningVisible: boolean,
): Record<string, any> | null | undefined {
  if (epreuve == null || typeof epreuve !== "object") return epreuve;

  const copy: Record<string, any> = {};
  for (const [key, value] of Object.entries(epreuve)) {
    if (HIDDEN.has(key)) continue;
    copy[key] = value;
  }
  // Consignes : seulement une fois le planning ouvert. On ne crée pas la clé
  // si l'objet ne la portait pas (jointure restreinte à quelques colonnes).
  if (!planningVisible && "description" in copy) {
    copy.description = null;
  }
  return copy;
}
