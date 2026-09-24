// Candidats éliminés (refusés à un tour).
//
// Un candidat refusé garde l'accès à son compte (profil, messages, demande de
// suppression) mais ne voit plus aucun créneau ni épreuve et ne peut plus
// s'inscrire. À la place, l'espace candidat lui affiche le message de refus
// qu'il a reçu par email.
//
// Le refus ne devient visible côté candidat qu'une fois OFFICIEL : pendant la
// soirée délibération, un « refusé » peut encore changer et le candidat ne
// doit pas l'apprendre par l'application avant l'email.

import { eliminatedAtTour, type DeliberationRow } from "./favorites";

/**
 * Texte de l'email de refus quand l'équipe n'a rédigé aucun message
 * (cf. buildResultEmail dans lib/resend.ts).
 */
export const DEFAULT_REFUSAL_MESSAGE =
  "Nous vous remercions pour votre candidature. Nous ne pourrons malheureusement pas y donner suite.";

/**
 * Les messages de refus envoyés sont gardés dans `system_settings` pour être
 * réaffichés tels quels au candidat. Ces clés ne doivent jamais sortir par
 * GET /api/settings, lisible par tous les candidats.
 */
export const REFUSAL_MESSAGE_KEY_PREFIX = "refusal_message_tour_";

/** Clé du message commun aux refusés d'un tour (mode « global »). */
export function refusalMessageKey(tour: number): string {
  return `${REFUSAL_MESSAGE_KEY_PREFIX}${tour}`;
}

/** Clé du message individualisé d'un refusé (mode « individual »). */
export function candidateRefusalMessageKey(
  tour: number,
  candidateId: string,
): string {
  return `${REFUSAL_MESSAGE_KEY_PREFIX}${tour}_${candidateId}`;
}

export function isRefusalMessageKey(key: string): boolean {
  return key.startsWith(REFUSAL_MESSAGE_KEY_PREFIX);
}

/**
 * Message à réafficher : l'individualisé s'il existe, sinon le commun, sinon
 * le texte par défaut — même priorité que l'email. Une chaîne vide enregistrée
 * veut dire « envoyé sans message », donc le texte par défaut.
 */
export function pickRefusalMessage(
  individual: string | null | undefined,
  global: string | null | undefined,
): string {
  if (individual != null) return individual.trim() || DEFAULT_REFUSAL_MESSAGE;
  return global?.trim() || DEFAULT_REFUSAL_MESSAGE;
}

/**
 * Tour auquel le candidat est officiellement éliminé, ou null.
 *
 * Le refus au tour N est officiel quand le tour N est clos (« termine ») ou
 * que le tour suivant a démarré : réouvrir le tour N pour corriger une autre
 * décision ne rend pas les créneaux du tour N+1 à ses refusés.
 */
export function officialEliminationTour(
  delib: DeliberationRow | null | undefined,
  tourStatusByNumber: Record<number, string | null | undefined>,
): number | null {
  const tour = eliminatedAtTour(delib);
  if (tour == null) return null;
  if (tourStatusByNumber[tour] === "termine") return tour;
  const next = tourStatusByNumber[tour + 1];
  if (next && next !== "a_venir") return tour;
  return null;
}

/**
 * Filtre PostgREST (`.or(...)`) des délibérations refusées à un tour
 * ANTÉRIEUR à `tour` : ces candidats ne participent pas au tour `tour`.
 * Null pour le tour 1, auquel tout le monde participe.
 */
export function refusedBeforeTourFilter(tour: number): string | null {
  const cols: string[] = [];
  for (let n = 1; n < tour && n <= 3; n++) {
    cols.push(`tour${n}_status.eq.refused`);
  }
  return cols.length ? cols.join(",") : null;
}
