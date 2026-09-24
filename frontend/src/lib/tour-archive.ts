// Archive des tours clos sur la page Évaluations.
//
// Une fois un tour passé en « termine », ses notes ne servent plus au travail
// courant : elles encombraient « Mes évaluations » et le récap admin (138
// lignes du tour 1 au moment d'ouvrir le tour 2). On les range, repliées, dans
// une section « Archives » — rien n'est supprimé ni exclu des statistiques.
//
// Module sans dépendance serveur : il est importé par la page client.

/** Numéro d'un tour d'après son nom (« Tour 2 » → 2), 0 si introuvable. */
export function extractTourNumber(name: string): number {
  const m = name.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Numéros des tours clos (statut « termine »), d'après la réponse de
 * GET /api/tours. En cas de doublon de numéro, le premier tour rencontré
 * fait foi — même règle que getToursByNumber côté serveur.
 */
export function closedTourNumbers(
  tours: { name?: string | null; status?: string | null }[] | null | undefined,
): Set<number> {
  const seen = new Set<number>();
  const closed = new Set<number>();
  for (const t of tours || []) {
    const n = extractTourNumber(String(t?.name || ""));
    if (!n || seen.has(n)) continue;
    seen.add(n);
    if (t.status === "termine") closed.add(n);
  }
  return closed;
}

/**
 * Sépare des éléments entre le travail courant et l'archive des tours clos.
 * Un élément dont le tour est inconnu reste dans le courant : mieux vaut une
 * ligne de trop à l'écran qu'une note qu'on ne retrouve plus. L'archive est
 * rangée du tour le plus récent au plus ancien ; l'ordre des éléments est
 * conservé à l'intérieur de chaque tour.
 */
export function splitByClosedTour<T>(
  items: T[],
  tourOf: (item: T) => number | string | null | undefined,
  closed: Set<number>,
): { current: T[]; archived: { tour: number; items: T[] }[] } {
  const current: T[] = [];
  const byTour = new Map<number, T[]>();
  for (const item of items) {
    const tour = Number(tourOf(item));
    if (Number.isFinite(tour) && tour > 0 && closed.has(tour)) {
      if (!byTour.has(tour)) byTour.set(tour, []);
      byTour.get(tour)!.push(item);
    } else {
      current.push(item);
    }
  }
  const archived = Array.from(byTour.entries())
    .sort(([a], [b]) => b - a)
    .map(([tour, list]) => ({ tour, items: list }));
  return { current, archived };
}
