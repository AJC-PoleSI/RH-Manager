/**
 * publish-understaffing — Publier un créneau qui n'a pas son compte
 * d'examinateurs, en connaissance de cause.
 *
 * Logique PURE (aucune I/O, aucun Supabase), partagée par la route
 * `/api/slots/publish-pending` et par l'écran planning : les deux doivent
 * compter EXACTEMENT les mêmes créneaux, sinon la case à cocher annonce un
 * nombre et le serveur en publie un autre.
 *
 * ── Le problème ──────────────────────────────────────────────────────
 * La publication exige jusqu'ici le jury au complet (`members >= min_members`).
 * C'est la bonne règle par défaut — mais elle n'a pas de porte de sortie :
 * un business game à 5 examinateurs déclarés pour un quota de 6 ne peut PAS
 * être ouvert aux candidats, alors que l'épreuve se tiendra très bien à 5.
 *
 * ── Pourquoi on baisse le quota du créneau ───────────────────────────
 * Publier sans toucher au quota ne suffirait pas : trois autres garde-fous
 * lisent `min_members` en aval et masqueraient quand même le créneau.
 *
 *   1. `/api/slots/available` — un candidat ne voit que les créneaux
 *      `published` dont `members >= min_members` ;
 *   2. `/api/slots/enroll` — même filtre au moment de choisir la salle ;
 *   3. le dispatch (`slotStatusAfterDispatch`) — un créneau sous son quota
 *      SANS inscrit repasse en `open` au run suivant, ce qui DÉFERAIT la
 *      publication en silence quelques minutes plus tard.
 *
 * Le créneau serait donc « publié » et invisible. Aligner le quota sur
 * l'effectif réellement présent dit la vérité — « ce créneau se tiendra à 5 »
 * — et fait tomber les trois verrous d'un coup, sans les affaiblir pour les
 * autres créneaux. La cible d'origine n'est pas perdue : elle reste sur
 * l'épreuve (`min_evaluators_per_salle`), ce qui permet d'afficher l'écart.
 *
 * ── Les deux limites qu'on ne franchit pas ───────────────────────────
 * 1. Un créneau à ZÉRO examinateur n'est jamais publié, case cochée ou non :
 *    un candidat s'y inscrirait pour se présenter devant une salle vide.
 *    C'est la situation « CRITIQUE » de dispatch-understaffing.ts, et elle
 *    reste un refus, pas un avertissement.
 * 2. Un créneau DÉJÀ PASSÉ n'entre pas dans la dérogation. La publication
 *    porte sur toute l'épreuve, et un business game en compte 90 étalés sur
 *    deux semaines : sans ce garde-fou, cocher la case pour ouvrir deux
 *    créneaux de mardi en rouvrirait quinze de la semaine dernière, en
 *    baissant leur quota au passage. Le chemin normal (jury au complet) n'est
 *    PAS filtré par date — on ne change pas son comportement historique.
 */

/** Quota d'examinateurs par défaut quand le créneau n'en porte pas. */
export const DEFAULT_MIN_MEMBERS = 2;

/**
 * Un créneau en attente de publication, tel que le serveur le lit et tel que
 * l'écran planning le manipule (d'où les deux graphies).
 */
export interface PendingSlotLike {
  id: string;
  status?: string | null;
  min_members?: number | null;
  minMembers?: number | null;
  members?: unknown[] | null;
  date?: string | null;
  start_time?: string | null;
  startTime?: string | null;
  room?: string | null;
}

/** Un créneau publié sous sa cible, et le quota à écrire pour lui. */
export interface UnderstaffedPublication {
  slotId: string;
  /** Examinateurs réellement affectés — le nouveau quota du créneau. */
  assigned: number;
  /** Quota avant publication, conservé pour l'affichage et les messages. */
  target: number;
  date: string;
  startTime: string;
  room: string | null;
}

/** Répartition des créneaux en attente entre publiés, forcés et refusés. */
export interface PublicationPlan {
  /** Jury au complet → publication normale, quota inchangé. */
  staffed: string[];
  /** Jury incomplet publié quand même, quota ramené à l'effectif présent. */
  understaffed: UnderstaffedPublication[];
  /** Jury incomplet laissé de côté (case non cochée). */
  heldUnderstaffed: UnderstaffedPublication[];
  /** Jury incomplet sur une date passée : hors dérogation (cf. en-tête). */
  pastUnderstaffed: UnderstaffedPublication[];
  /** Aucun examinateur : jamais publiable, quelle que soit la case. */
  noExaminer: UnderstaffedPublication[];
}

/** Effectif et quota d'un créneau, quelle que soit la graphie des champs. */
function readCounts(slot: PendingSlotLike): { assigned: number; target: number } {
  const assigned = (slot.members || []).length;
  const target =
    Number(slot.min_members ?? slot.minMembers) || DEFAULT_MIN_MEMBERS;
  return { assigned, target };
}

function describe(
  slot: PendingSlotLike,
  assigned: number,
  target: number,
): UnderstaffedPublication {
  return {
    slotId: slot.id,
    assigned,
    target,
    date: String(slot.date || ""),
    startTime: String(slot.start_time ?? slot.startTime ?? ""),
    room: slot.room ?? null,
  };
}

/**
 * Ce que la publication ferait de chaque créneau en attente.
 *
 * `allowUnderstaffed` ne crée aucune exception nouvelle : il déplace
 * simplement les créneaux de `heldUnderstaffed` vers `understaffed`. Les
 * créneaux sans examinateur restent dans `noExaminer` dans les deux cas.
 */
export function planPublication(
  slots: PendingSlotLike[] | null | undefined,
  options: { allowUnderstaffed?: boolean; today?: string } = {},
): PublicationPlan {
  const allow = options.allowUnderstaffed === true;
  // "YYYY-MM-DD". Absent → aucun filtre de date (le comportement d'avant).
  const today = options.today ? options.today.substring(0, 10) : null;
  const plan: PublicationPlan = {
    staffed: [],
    understaffed: [],
    heldUnderstaffed: [],
    pastUnderstaffed: [],
    noExaminer: [],
  };

  for (const slot of slots || []) {
    if (!slot?.id) continue;
    const { assigned, target } = readCounts(slot);

    if (assigned >= target) {
      plan.staffed.push(slot.id);
      continue;
    }
    if (assigned === 0) {
      plan.noExaminer.push(describe(slot, assigned, target));
      continue;
    }

    const described = describe(slot, assigned, target);
    const day = described.date.substring(0, 10);
    // Comparaison de chaînes "YYYY-MM-DD" : ordonnée lexicographiquement comme
    // chronologiquement, et insensible au fuseau du runtime (les dates sont
    // stockées à 12:00Z, cf. les créneaux en base).
    if (today && day && day < today) {
      plan.pastUnderstaffed.push(described);
      continue;
    }

    (allow ? plan.understaffed : plan.heldUnderstaffed).push(described);
  }

  return plan;
}

/** Nombre total de créneaux que la publication ferait passer en `published`. */
export function publishedCount(plan: PublicationPlan): number {
  return plan.staffed.length + plan.understaffed.length;
}

/**
 * Bilan en une phrase, affiché en toast après publication.
 *
 * Les créneaux sans examinateur sont nommés à part : les fondre dans le
 * total des « ignorés » laisserait croire qu'ils se publieront tout seuls
 * quand un examinateur de plus arrivera, alors qu'ils n'en ont AUCUN.
 */
export function summarizePublication(plan: PublicationPlan): string {
  const total = publishedCount(plan);
  const parts: string[] = [
    total === 0
      ? "Aucun nouveau créneau à publier"
      : `${total} créneau(x) publié(s) aux candidats`,
  ];

  if (plan.understaffed.length > 0) {
    parts.push(
      `dont ${plan.understaffed.length} en sous-effectif assumé ` +
        `(quota ramené à l'effectif présent)`,
    );
  }
  if (plan.heldUnderstaffed.length > 0) {
    parts.push(
      `${plan.heldUnderstaffed.length} en attente d'un jury complet`,
    );
  }
  if (plan.pastUnderstaffed.length > 0) {
    parts.push(
      `${plan.pastUnderstaffed.length} en sous-effectif sur une date passée — ignoré(s)`,
    );
  }
  if (plan.noExaminer.length > 0) {
    parts.push(
      `${plan.noExaminer.length} sans aucun examinateur — non publiable(s)`,
    );
  }

  return parts.join(" · ");
}

/**
 * Date du jour à Paris, en "YYYY-MM-DD".
 *
 * Le serveur tourne en UTC sur Vercel, l'écran dans le fuseau du navigateur :
 * sans fuseau explicite, les deux pourraient être en désaccord d'une journée
 * entre minuit et 2h du matin — et l'aperçu affiché n'annoncerait pas les
 * mêmes créneaux que ceux réellement publiés.
 *
 * `en-CA` formate en ISO. Repli sur l'UTC si l'ICU du runtime ne connaît pas
 * le fuseau : on préfère un décalage d'une heure à une exception.
 */
export function todayInParis(now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().substring(0, 10);
  }
}
