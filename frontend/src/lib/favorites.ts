// Coups de cœur du jury.
//
// Chaque membre dispose de 5 cœurs pour TOUT le recrutement, au plus un par
// candidat. Un cœur posé sur un candidat qui a ensuite été refusé ne compte
// plus dans le quota : le membre le récupère pour un autre candidat, sans
// avoir à retirer le cœur du refusé (l'historique reste lisible en délib).
//
// Un membre ne voit que ses propres cœurs ; l'admin voit ceux de tout le
// monde. Ce cloisonnement est appliqué dans les routes, pas ici.

/** Nombre de cœurs par membre. */
export const MAX_FAVORITES = 5;

/** Les trois colonnes de statut de la table `deliberations`. */
export const TOUR_STATUS_KEYS = [
  "tour1_status",
  "tour2_status",
  "tour3_status",
] as const;

export interface DeliberationRow {
  tour1_status?: string | null;
  tour2_status?: string | null;
  tour3_status?: string | null;
}

/**
 * Un candidat est éliminé dès qu'il est refusé à l'un des tours : il ne
 * participe pas au tour suivant. Dans l'organigramme, il passe en fin de
 * liste et sa photo est grisée.
 */
export function isEliminated(delib: DeliberationRow | null | undefined): boolean {
  if (!delib) return false;
  return TOUR_STATUS_KEYS.some((k) => delib[k] === "refused");
}

/** Numéro du tour auquel le candidat a été refusé, ou null s'il est encore en lice. */
export function eliminatedAtTour(
  delib: DeliberationRow | null | undefined,
): number | null {
  if (!delib) return null;
  for (let i = 0; i < TOUR_STATUS_KEYS.length; i++) {
    if (delib[TOUR_STATUS_KEYS[i]] === "refused") return i + 1;
  }
  return null;
}

/**
 * Cœurs qui pèsent sur le quota : ceux posés sur des candidats encore en lice.
 *
 * `eliminatedIds` porte les candidats refusés — leurs cœurs sont conservés en
 * base (on veut savoir qui avait flashé sur qui) mais rendus au membre.
 */
export function countActiveFavorites(
  favoriteCandidateIds: string[],
  eliminatedIds: Set<string>,
): number {
  return favoriteCandidateIds.filter((id) => !eliminatedIds.has(id)).length;
}

/** Reste-t-il un cœur disponible ? */
export function hasFavoriteQuotaLeft(
  favoriteCandidateIds: string[],
  eliminatedIds: Set<string>,
): boolean {
  return countActiveFavorites(favoriteCandidateIds, eliminatedIds) < MAX_FAVORITES;
}
