/**
 * wishes-reminder — règles de la relance « vœux de pôle non remplis ».
 *
 * Module PUR (aucun accès Supabase/réseau) : les lignes sont lues par
 * l'appelant (`lib/wishes-reminder-db.ts`) et la décision se prend ici. C'est
 * ce qui permet au bandeau candidat (`GET /api/wishes/status`), au bouton
 * admin et au cron du matin de partager EXACTEMENT le même critère — un
 * bandeau qui dirait « vos vœux sont attendus » à un candidat que le cron ne
 * relancerait pas (ou l'inverse) serait incompréhensible pour lui.
 *
 * Qui est concerné (spec § 7.1) : admis au tour 1 (c'est la condition qui
 * débloque la saisie des vœux dans `PUT /api/wishes/[candidateId]`), encore
 * en lice (aucun refus), sans AUCUN vœu, vœux non verrouillés, tant que le
 * Tour 2 n'est pas clos. L'espacement entre deux mails (≥ 3 jours) ne
 * s'applique qu'à l'envoi, pas au bandeau.
 */

/** Jours minimum entre deux mails de relance à un même candidat. */
export const WISHES_REMINDER_INTERVAL_DAYS = 3;

export const WISHES_REMINDER_SUBJECT = "Vos choix de pôles — pensez à les remplir";

/**
 * Corps du mail. Le gabarit `sendAnnouncementEmails` (lib/resend.ts) ajoute
 * déjà « Bonjour {prénom}, » en tête : ne pas le répéter ici. Signature
 * identique aux autres mails candidats (cf. mémoire rh-signature-christine).
 */
export const WISHES_REMINDER_BODY =
  "N'oubliez pas de remplir vos choix de pôles sur votre espace candidat. " +
  "Ils ne sont pas définitifs : ils sont indicatifs et nous permettent de savoir " +
  "approximativement ce que vous souhaiteriez. Ils seront pris en compte.\n\n" +
  "Merci,\nChristine Lamaille";

export interface ReminderCandidate {
  id: string;
  email: string | null;
  first_name: string | null;
  /** `undefined` si la colonne n'est pas lue : seul `false` exclut. */
  email_verified?: boolean | null;
  wishes_locked_at?: string | null;
  wishes_reminded_at?: string | null;
}

export interface ReminderDelib {
  candidate_id: string;
  tour1_status?: string | null;
  tour2_status?: string | null;
  tour3_status?: string | null;
}

/**
 * Le candidat doit-il (encore) remplir ses vœux ?
 *
 * Critère partagé par le bandeau et la relance mail — sans l'espacement.
 * Un candidat sans ligne de délibération n'a pas été admis au T1 : la saisie
 * des vœux lui est fermée, inutile de la lui réclamer.
 */
export function needsWishes(
  c: ReminderCandidate,
  d: ReminderDelib | undefined,
  hasWishes: boolean,
  tour2Status: string | null | undefined,
): boolean {
  if (hasWishes) return false;
  if (c.wishes_locked_at) return false;
  // Tour 2 clos : les vœux ont servi (ou pas), on ne harcèle plus personne.
  if (tour2Status === "termine") return false;
  if (!d || d.tour1_status !== "accepted") return false;
  if ([d.tour1_status, d.tour2_status, d.tour3_status].includes("refused")) {
    return false;
  }
  return true;
}

/**
 * Candidats à relancer par mail aujourd'hui.
 *
 * Email obligatoire et vérifié : un rappel sur une adresse jamais validée
 * partirait dans le vide et consommerait le quota Resend pour rien.
 * `email_verified === undefined` (colonne non lue) ne bloque pas.
 */
export function selectCandidatesToRemind(o: {
  candidates: ReminderCandidate[];
  deliberations: ReminderDelib[];
  wishCandidateIds: Iterable<string>;
  tour2Status: string | null | undefined;
  now?: Date;
}): ReminderCandidate[] {
  const now = o.now ?? new Date();
  const delib = new Map(o.deliberations.map((d) => [d.candidate_id, d]));
  const withWishes = new Set(o.wishCandidateIds);
  const minMs = WISHES_REMINDER_INTERVAL_DAYS * 24 * 3600 * 1000;

  return o.candidates.filter((c) => {
    if (!c.email || c.email_verified === false) return false;
    if (!needsWishes(c, delib.get(c.id), withWishes.has(c.id), o.tour2Status)) {
      return false;
    }
    // Espacement : relancé il y a moins de 3 jours → pas aujourd'hui.
    if (
      c.wishes_reminded_at &&
      now.getTime() - new Date(c.wishes_reminded_at).getTime() < minMs
    ) {
      return false;
    }
    return true;
  });
}
