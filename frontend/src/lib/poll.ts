"use client";

/**
 * poll — cadence unique pour tous les rafraîchissements automatiques.
 *
 * CONTEXTE (17/09/2026) : chaque écran vivant de l'app rejouait son `fetch`
 * toutes les 5 secondes, la plupart du temps SANS vérifier que l'onglet était
 * visible. Un onglet « planning » ou « chat » laissé ouvert en arrière-plan
 * continuait donc à interroger Supabase 720 fois par heure. Multiplié par les
 * onglets du jury et des candidats, le pool de connexions Postgres saturait
 * ("connection not available and request was dropped from queue") et la base
 * renvoyait 522 — l'app tombait, sans que personne n'ait rien fait.
 *
 * Deux règles ici :
 *  1. On ne requête JAMAIS pour un onglet caché (`document.hidden`).
 *  2. Le retour sur l'onglet déclenche un rafraîchissement immédiat.
 *
 * Résultat : on peut espacer l'intervalle sans que l'écran paraisse figé —
 * l'utilisateur qui revient voit des données fraîches tout de suite.
 */

/** Intervalles en millisecondes, par famille d'écran. */
export const POLL = {
  /** Planning admin/membre : inscriptions et jury qui bougent. */
  planning: 30_000,
  /** Écrans candidats (épreuves, créneaux). */
  candidate: 30_000,
  /** Chat interne et messagerie. */
  chat: 20_000,
  /** Cloche de notifications. */
  notifications: 60_000,
} as const;

/** Vrai si l'onglet est au premier plan (ou si on ne peut pas le savoir). */
export function isTabVisible(): boolean {
  return typeof document === "undefined" || !document.hidden;
}

/**
 * Lance un rafraîchissement périodique et renvoie sa fonction d'arrêt, à
 * retourner telle quelle depuis un `useEffect`.
 *
 * ```ts
 * useEffect(() => startPolling(fetchMessages, POLL.chat), [fetchMessages]);
 * ```
 *
 * Le premier appel n'est PAS déclenché ici : les écrans font déjà leur
 * chargement initial eux-mêmes, et le rejouer provoquerait un double fetch au
 * montage.
 */
export function startPolling(fn: () => void, intervalMs: number): () => void {
  const tick = () => {
    if (!isTabVisible()) return;
    fn();
  };

  const id = setInterval(tick, intervalMs);

  // Retour sur l'onglet : on ne fait pas attendre l'utilisateur jusqu'au
  // prochain tick, sinon espacer l'intervalle se verrait à l'écran.
  const onVisible = () => {
    if (isTabVisible()) fn();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);

  return () => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
  };
}
