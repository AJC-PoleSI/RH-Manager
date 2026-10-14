/**
 * wishes-deadline — Jusqu'à quand un candidat peut-il saisir ses vœux de pôle ?
 *
 * Le réglage `voeux_cloture_le` de `system_settings` porte l'instant de
 * clôture. Passé cet instant, un CANDIDAT ne peut plus écrire ses vœux
 * (`PUT /api/wishes/[candidateId]`) et le formulaire passe en lecture seule
 * (`GET /api/wishes/access`). Les membres et admins gardent la main (jury).
 *
 * Valeur attendue : « AAAA-MM-JJ HH:MM » en HEURE DE PARIS (ex. « 2026-10-15
 * 17:00 »), ou un instant ISO complet avec fuseau. Une date seule est refusée :
 * minuit de quel fuseau ?
 *
 * Pourquoi un réglage horodaté et pas un cron qui pose `wishes_locked_at` :
 * la clôture tombe à la seconde près sans dépendre d'un passage de cron, ne
 * modifie aucune donnée (rien à défaire si l'heure change : on met à jour la
 * valeur) et ne confond pas « clos » avec « confirmé définitivement ».
 *
 * FAIL-OPEN : réglage absent, vide, illisible ou base injoignable → vœux
 * ouverts, comme avant l'existence de ce réglage. Bloquer tous les candidats
 * sur une lecture ratée serait pire que de les laisser saisir.
 *
 * À NETTOYER : la valeur n'expire pas. Une échéance restée en base ferme les
 * vœux de TOUT futur recrutement — supprimer la ligne une fois le Tour 3 clos.
 */

import { parisInstantMs, type SettingReader } from "./enrollment-window";

/** Clé du réglage dans `system_settings`. */
export const WISHES_DEADLINE_SETTING_KEY = "voeux_cloture_le";

/** Message candidat quand la saisie est refusée après l'échéance. */
export const WISHES_CLOSED_MESSAGE =
  "Les choix de pôles sont clos : ils ne peuvent plus être modifiés.";

/** Instant de clôture (epoch ms), ou null si la valeur est absente/illisible. */
export function parseWishesDeadline(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;

  const wall = v.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/);
  if (wall) {
    const ms = parisInstantMs(wall[1], wall[2]);
    return Number.isNaN(ms) ? null : ms;
  }

  // Instant complet : le fuseau (Z ou ±hh:mm) est obligatoire.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v)) {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/** Les vœux sont-ils clos pour les candidats à cet instant ? */
export function isWishesClosed(
  deadlineValue: unknown,
  now: Date = new Date(),
): boolean {
  const ms = parseWishesDeadline(deadlineValue);
  return ms !== null && now.getTime() >= ms;
}

/** Lit la valeur brute du réglage ; toute anomalie rend null (vœux ouverts). */
export async function readWishesDeadline(
  read: SettingReader,
): Promise<string | null> {
  try {
    const { data, error } = await read(WISHES_DEADLINE_SETTING_KEY);
    if (error) return null;
    return data?.value ?? null;
  } catch {
    return null;
  }
}
