/**
 * Sélection du jeu de vœux à afficher pour un candidat.
 *
 * Depuis `supabase-migration-wishes-tour.sql`, un candidat porte DEUX jeux de
 * vœux : ceux du tour 2 (provisoires, servant à dimensionner le tour 3) et
 * ceux du tour 3 (définitifs). Les deux cohabitent en base, par conception.
 *
 * L'audit du 07/09/2026 a montré que plusieurs écrans lisaient
 * `candidate_wishes` sans filtrer sur `tour` : les KPI par pôle comptaient
 * chaque candidat deux fois, et le trombinoscope pouvait afficher un premier
 * vœu du tour 2 déjà périmé (l'ordre de retour de PostgREST n'étant pas
 * garanti) au lieu du choix définitif du tour 3.
 *
 * Règle unique appliquée partout : on ne garde que le tour le plus avancé
 * réellement saisi par le candidat. Si la colonne `tour` n'est pas encore
 * posée en base, toutes les lignes retombent sur 0 et sont donc conservées —
 * le comportement reste alors celui d'avant la migration.
 */

interface TourScoped {
  tour?: number | null;
}

/** Vœux du tour le plus avancé pour UN candidat. */
export function latestTourWishes<T extends TourScoped>(wishes: T[] | null | undefined): T[] {
  const rows = wishes ?? [];
  if (rows.length === 0) return [];

  let maxTour = -1;
  for (const w of rows) {
    const t = Number(w.tour ?? 0);
    if (t > maxTour) maxTour = t;
  }
  return rows.filter((w) => Number(w.tour ?? 0) === maxTour);
}

/**
 * Même règle, appliquée à un lot de vœux couvrant PLUSIEURS candidats :
 * chaque candidat garde son propre tour le plus avancé (certains ont déjà
 * confirmé au tour 3, d'autres non).
 */
export function latestTourWishesByCandidate<
  T extends TourScoped & { candidate_id?: string | null },
>(wishes: T[] | null | undefined): T[] {
  const rows = wishes ?? [];
  if (rows.length === 0) return [];

  const maxByCandidate = new Map<string, number>();
  for (const w of rows) {
    const id = String(w.candidate_id ?? "");
    const t = Number(w.tour ?? 0);
    if (t > (maxByCandidate.get(id) ?? -1)) maxByCandidate.set(id, t);
  }
  return rows.filter(
    (w) => Number(w.tour ?? 0) === maxByCandidate.get(String(w.candidate_id ?? "")),
  );
}
