/**
 * enrollment-window — Jusqu'à quand un candidat peut-il réserver un créneau ?
 *
 * RÈGLE PAR DÉFAUT : pas d'inscription à moins de 24h du début. Le jury, les
 * salles et les convocations sont arrêtés la veille ; un candidat qui s'ajoute
 * le matin même arrive sur un créneau dont personne n'a été prévenu.
 *
 * L'EXCEPTION : au lancement d'un tour, cette règle ferme les premiers jours
 * AVANT même que les candidats aient eu le temps de s'inscrire (le dimanche
 * après-midi, les créneaux du lundi matin sont déjà hors délai). Le réglage
 * `inscription_sans_delai_jusqu_au` — une DATE, pas un interrupteur — rouvre
 * les créneaux JUSQU'À CETTE DATE INCLUSE : ils restent réservables jusqu'à
 * leur début. Les créneaux suivants gardent leurs 24h, qui se rétablissent
 * donc toutes seules le lendemain : rien à repasser à la main.
 *
 * Pourquoi une date de créneau et pas une deadline par épreuve : une même
 * épreuve (« Entretien individuel ») porte des créneaux sur toute la semaine.
 * Seule la date du CRÉNEAU distingue « lundi, dernière minute acceptée » de
 * « mardi, 24h de préavis ».
 *
 * FAIL-CLOSED : réglage absent, vide, illisible ou base injoignable → règle
 * des 24h, c'est-à-dire le comportement historique à l'identique.
 */

/** Clé du réglage dans `system_settings` (valeur attendue : "AAAA-MM-JJ"). */
export const LAST_MINUTE_SETTING_KEY = "inscription_sans_delai_jusqu_au";

/** Préavis exigé par défaut, en heures. */
export const MIN_NOTICE_HOURS = 24;

/** Sous-ensemble minimal du client Supabase utilisé ici. */
export interface SettingsClient {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => {
        // PromiseLike et non Promise : le query builder Supabase est un
        // thenable, pas une vraie Promise (il n'a ni .catch ni .finally).
        maybeSingle: () => PromiseLike<{
          data: { value?: string | null } | null;
          error: unknown;
        }>;
      };
    };
  };
}

/** Jour "AAAA-MM-JJ" d'une valeur stockée ("2026-09-14" ou ISO complet). */
function toDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Le créneau est-il dispensé du préavis de 24h ?
 * Comparaison de jours en texte (AAAA-MM-JJ trie chronologiquement), donc
 * aucune dérive de fuseau : le 14/09 à Paris reste le 14/09 sur un serveur UTC.
 */
export function isLastMinuteWaived(
  slotDate: unknown,
  waiveUntil: unknown,
): boolean {
  const day = toDay(slotDate);
  const until = toDay(waiveUntil);
  if (!day || !until) return false;
  return day <= until;
}

export type EnrollmentRefusal = "started" | "notice";

export type EnrollmentWindowVerdict =
  | { allowed: true }
  | { allowed: false; reason: EnrollmentRefusal };

/** Messages candidats, un par motif de refus. */
export const ENROLLMENT_WINDOW_MESSAGES: Record<EnrollmentRefusal, string> = {
  started: "Ce créneau a déjà commencé : les inscriptions sont closes.",
  notice:
    "Les inscriptions sont fermées pour ce créneau (moins de 24h avant l'épreuve).",
};

export interface EnrollmentWindowInput {
  /** `evaluation_slots.date` ("2026-09-14" ou ISO). */
  date: string | null | undefined;
  /** `evaluation_slots.start_time` ("09:00" ou "09:00:00"). */
  startTime: string | null | undefined;
  /** Valeur du réglage `inscription_sans_delai_jusqu_au`, ou null. */
  waiveUntil?: string | null;
  now?: Date;
}

/**
 * Le candidat peut-il encore s'inscrire sur ce créneau ?
 *
 * - Créneau dispensé → oui, jusqu'à l'instant du début (jamais après : on ne
 *   s'inscrit pas à une épreuve en cours).
 * - Sinon → oui tant qu'il reste au moins 24h.
 * - Date ou horaire manquant / illisible → oui (on ne bloque pas sur une
 *   donnée qu'on ne sait pas lire ; c'était déjà le cas avant).
 */
export function checkEnrollmentWindow({
  date,
  startTime,
  waiveUntil = null,
  now = new Date(),
}: EnrollmentWindowInput): EnrollmentWindowVerdict {
  if (!date || !startTime) return { allowed: true };

  const day = String(date).split("T")[0];
  const start = new Date(`${day}T${startTime}`);
  if (isNaN(start.getTime())) return { allowed: true };

  const hoursUntil = (start.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (isLastMinuteWaived(date, waiveUntil)) {
    return hoursUntil > 0
      ? { allowed: true }
      : { allowed: false, reason: "started" };
  }

  return hoursUntil >= MIN_NOTICE_HOURS
    ? { allowed: true }
    : { allowed: false, reason: "notice" };
}

/**
 * Lit le réglage d'exception. Toute anomalie (colonne/ligne absente, base
 * injoignable) rend `null` → la règle des 24h s'applique.
 */
export async function readLastMinuteWaiveUntil(
  client: SettingsClient,
): Promise<string | null> {
  try {
    const { data, error } = await client
      .from("system_settings")
      .select("value")
      .eq("key", LAST_MINUTE_SETTING_KEY)
      .maybeSingle();
    if (error) return null;
    return toDay(data?.value);
  } catch {
    return null;
  }
}
