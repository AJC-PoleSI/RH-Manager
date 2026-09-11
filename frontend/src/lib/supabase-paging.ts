/**
 * supabase-paging — Lecture EXHAUSTIVE d'une table Supabase.
 *
 * PostgREST plafonne toute réponse à `db-max-rows` (1000 sur nos projets
 * hébergés). Une requête sans `.range()` ne renvoie donc JAMAIS plus de 1000
 * lignes — SANS erreur, sans avertissement, et sans ordre garanti.
 *
 * Bug vécu (diagnostic du 11/09/2026) : `runDispatch` lisait
 * `evaluation_slots` (1076 lignes en base) et `slot_member_assignments`
 * (1189 lignes) sans pagination. Il ne voyait donc que 1000 de chaque, dans un
 * ordre arbitraire qui pouvait changer d'un run à l'autre : 76 créneaux et 189
 * affectations étaient invisibles à chaque recalcul. Un examinateur qui
 * changeait sa disponibilité sur cette zone aveugle n'était jamais pris en
 * compte — le planning restait figé, sans la moindre trace d'erreur.
 *
 * Aucune dépendance module-level à Supabase : la requête est TOUJOURS
 * construite par l'appelant, ce module ne fait que la rejouer page par page.
 * Il est donc testable avec un simple mock (voir supabase-paging.test.ts).
 */

/** Réponse minimale d'une requête Supabase, telle que consommée ici. */
export interface PagedResponse<T> {
  data: T[] | null;
  error: unknown;
}

/**
 * Construit la requête pour UNE page. `from`/`to` sont des indices inclusifs,
 * à passer tels quels à `.range(from, to)`.
 */
export type PageQuery<T> = (
  from: number,
  to: number,
) => PromiseLike<PagedResponse<T>>;

export const PAGE_SIZE = 1000;

/**
 * Garde-fou : au-delà, on considère que la pagination ne progresse pas (une
 * requête qui renverrait toujours une page pleine boucherait indéfiniment).
 * 500 pages = 500 000 lignes, très au-delà de tout volume réaliste ici.
 */
const MAX_PAGES = 500;

/**
 * Lit TOUTES les lignes d'une requête, page par page.
 *
 * La requête passée DOIT porter un ordre stable (`.order("id")` suffit) :
 * sans ordre déterministe, deux pages successives peuvent se recouvrir ou
 * sauter des lignes.
 *
 * Renvoie la même forme qu'une réponse Supabase (`{ data, error }`) pour que
 * les appelants gardent leur logique de repli existante (colonne absente,
 * table absente…). La première erreur rencontrée interrompt la lecture et est
 * renvoyée telle quelle : mieux vaut ne rien recalculer que recalculer sur une
 * vue partielle — c'est exactement le bug d'origine.
 */
export async function fetchAllRows<T>(
  buildQuery: PageQuery<T>,
  pageSize: number = PAGE_SIZE,
): Promise<PagedResponse<T>> {
  const all: T[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * pageSize;
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) return { data: null, error };

    const rows = data || [];
    all.push(...rows);

    // Page incomplète = dernière page. C'est le seul critère d'arrêt fiable :
    // demander le total à part (`count: "exact"`) ouvrirait une fenêtre de
    // course avec les écritures concurrentes.
    if (rows.length < pageSize) return { data: all, error: null };
  }

  return {
    data: null,
    error: new Error(
      `fetchAllRows: ${MAX_PAGES} pages atteintes (${MAX_PAGES * pageSize} lignes) — ` +
        "requête sans ordre stable ou volume anormal.",
    ),
  };
}
