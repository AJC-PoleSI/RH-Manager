/**
 * announcements — règles de ciblage d'une annonce générale.
 *
 * Module PUR (aucun accès réseau/Supabase) : l'audience se calcule à partir
 * des lignes déjà lues par l'appelant. C'est ce qui permet à l'aperçu
 * (« combien de destinataires ? ») et à l'envoi réel de partager exactement
 * le même code — un aperçu qui mentirait sur le volume ferait dépasser le
 * quota d'emails sans prévenir.
 */

export type CandidateFilter =
  | "all"
  | "en_lice"
  | "accepted_tour1"
  | "accepted_tour2"
  | "accepted_tour3"
  | "refused";

export const CANDIDATE_FILTERS: { value: CandidateFilter; label: string }[] = [
  { value: "all", label: "Tous les candidats" },
  { value: "en_lice", label: "Encore en lice (aucun refus)" },
  { value: "accepted_tour1", label: "Admis au tour 1" },
  { value: "accepted_tour2", label: "Admis au tour 2" },
  { value: "accepted_tour3", label: "Admis au tour 3" },
  { value: "refused", label: "Refusés" },
];

export function isCandidateFilter(value: unknown): value is CandidateFilter {
  return CANDIDATE_FILTERS.some((f) => f.value === value);
}

/** Statuts de délibération d'un candidat, tels que stockés en base. */
export interface DeliberationStatuses {
  tour1_status?: string | null;
  tour2_status?: string | null;
  tour3_status?: string | null;
}

const TOUR_COLUMNS = [
  "tour1_status",
  "tour2_status",
  "tour3_status",
] as const;

/**
 * Un candidat correspond-il au filtre choisi ?
 *
 * `delib` peut être absent : un candidat sans ligne de délibération n'a été
 * ni admis ni refusé — il est « en lice », mais admis à aucun tour.
 */
export function candidateMatchesFilter(
  filter: CandidateFilter,
  delib?: DeliberationStatuses | null,
): boolean {
  const statuses = TOUR_COLUMNS.map((col) => delib?.[col] ?? null);

  switch (filter) {
    case "all":
      return true;
    case "en_lice":
      return !statuses.includes("refused");
    case "refused":
      return statuses.includes("refused");
    case "accepted_tour1":
      return statuses[0] === "accepted";
    case "accepted_tour2":
      return statuses[1] === "accepted";
    case "accepted_tour3":
      return statuses[2] === "accepted";
    default:
      return false;
  }
}

/**
 * Plafond journalier d'emails.
 *
 * Resend applique 100 emails/jour (et 3 000/mois) sur le plan gratuit ;
 * `RESEND_DAILY_CAP` permet de le relever sans redéploiement si le compte
 * passe en Pro. Le compteur ne connaît QUE les emails d'annonces : les
 * emails transactionnels (vérification, résultats de délibération, mot de
 * passe oublié) consomment le même quota sans être comptés ici — d'où la
 * marge que l'UI affiche à l'admin.
 */
export const EMAIL_DAILY_CAP = Number(process.env.RESEND_DAILY_CAP ?? 100);

/**
 * Taille d'un lot d'envoi Resend : l'API `batch.send` accepte 100 emails par
 * requête. Un lot = UNE requête, ce qui évite aussi la limite de 2 req/s
 * (l'envoi en parallèle un-par-un déclenche des 429 silencieux au-delà de
 * deux destinataires).
 */
export const EMAIL_BATCH_SIZE = 100;

export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk: taille de lot invalide");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Début du jour UTC courant — la fenêtre sur laquelle Resend compte le quota. */
export function startOfUtcDay(now: Date = new Date()): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return d.toISOString();
}
