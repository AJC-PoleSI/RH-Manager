/**
 * dispatch-understaffing — Sous-effectif des créneaux : statut, bascule, alerte.
 *
 * Logique PURE (aucune I/O, aucun Supabase), testée unitairement — même
 * contrat que dispatch-core.ts et dispatch-io.ts.
 *
 * ── Règle métier (décision de Felix, 11/09/2026) ─────────────────────
 * Un créneau où un candidat s'est DÉJÀ inscrit est un rendez-vous pris. Il ne
 * doit pas disparaître de la circulation parce qu'il a perdu un examinateur :
 * il tourne avec un seul examinateur, signalé comme tel, et tout le monde est
 * prévenu. Avant ce changement, le dispatch le rétrogradait en `open` — donc
 * hors de la liste de réservation, sans que personne ne soit averti (8 cas en
 * base au 11/09/2026, dont 6 à ZÉRO examinateur).
 *
 * Le cas « zéro examinateur » reste distinct : le créneau est fermé aux
 * NOUVELLES inscriptions (statut `open`, qui reste visible du seul candidat
 * déjà inscrit — cf. /api/slots/available), et déclenche une alerte séparée
 * pour ne pas se noyer dans le lot des créneaux à 1 examinateur.
 */

// ─── Inscriptions candidats ───────────────────────────────────────────

/** Une ligne de `slot_enrollments`, réduite à ce qui compte ici. */
export interface EnrollmentLike {
  status?: string | null;
}

/**
 * Nombre de candidats RÉELLEMENT inscrits sur un créneau.
 *
 * `status` nul est traité comme actif : c'est la valeur des lignes créées
 * avant l'ajout de la colonne, et la seule valeur présente en base
 * aujourd'hui est `active` (77 lignes au 11/09/2026). Tout autre statut
 * (`cancelled`…) ne compte pas.
 */
export function activeEnrollmentCount(
  enrollments?: EnrollmentLike[] | null,
): number {
  if (!enrollments) return 0;
  return enrollments.filter((e) => !e?.status || e.status === "active").length;
}

// ─── Statut d'un créneau après dispatch ───────────────────────────────

export type SlotStatus = "published" | "ready" | "open";

export interface StatusInput {
  /** Examinateurs affectés à l'issue du run. */
  assigned: number;
  /** Quota du créneau (`min_members`, 2 par défaut). */
  minMembers: number;
  /** Candidats déjà inscrits (cf. activeEnrollmentCount). */
  candidates: number;
  /** Réglage global `planning_visible_candidats`. */
  planningVisible: boolean;
}

/**
 * Statut à poser sur un créneau à l'issue du dispatch.
 *
 * - Jury au complet → règle historique (publié si le planning est ouvert aux
 *   candidats, sinon prêt).
 * - Sous-effectif MAIS au moins un examinateur ET au moins un candidat inscrit
 *   → on garde le créneau en circulation (c'est la tolérance demandée).
 * - Tout le reste (sous-effectif sans candidat, ou zéro examinateur) → `open` :
 *   le créneau retourne au pool, invisible des candidats qui n'y sont pas déjà
 *   inscrits.
 */
export function slotStatusAfterDispatch(input: StatusInput): SlotStatus {
  const { assigned, minMembers, candidates, planningVisible } = input;
  const staffed = assigned >= minMembers;
  const tolerated = !staffed && candidates > 0 && assigned >= 1;

  if (!staffed && !tolerated) return "open";
  return planningVisible ? "published" : "ready";
}

// ─── Bascule en sous-effectif ─────────────────────────────────────────

/**
 * Le créneau vient-il de TOMBER en sous-effectif pendant ce run ?
 *
 * Le dispatch tourne à chaque sauvegarde de disponibilité : notifier tous les
 * examinateurs à chaque run pour chaque créneau incomplet serait ingérable
 * (648 créneaux en sous-effectif au 11/09/2026). On ne notifie donc que la
 * transition — un créneau déjà incomplet au run précédent ne renotifie pas.
 */
export function isNewlyUnderstaffed(
  before: number,
  after: number,
  minMembers: number,
): boolean {
  return before >= minMembers && after < minMembers;
}

// ─── Composition des alertes ──────────────────────────────────────────

export interface UnderstaffedSlot {
  slotId: string;
  /** "YYYY-MM-DD" (ou ISO — seuls les 10 premiers caractères sont lus). */
  date: string;
  /** "HH:MM" (ou "HH:MM:SS" — seuls les 5 premiers caractères sont lus). */
  startTime: string;
  room?: string | null;
  assigned: number;
  needed: number;
  candidates: number;
}

/** Notification in-app, forme attendue par `notifyMembers`. */
export interface DispatchNotification {
  type: string;
  title: string;
  body: string;
  link: string;
}

const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

/** Nombre de créneaux détaillés avant de basculer sur « … et N autres ». */
export const MAX_LISTED = 5;

const AVAILABILITY_LINK = "/dashboard/availability";

/**
 * "mar. 16/09 15h30 — salle 205".
 *
 * Formatage manuel plutôt que `toLocaleDateString` : le résultat doit être
 * identique quel que soit l'ICU du runtime (Vercel, machine locale, CI).
 */
export function formatSlotLabel(slot: UnderstaffedSlot): string {
  const ymd = String(slot.date || "").substring(0, 10);
  const [y, m, d] = ymd.split("-");
  const hhmm = String(slot.startTime || "").substring(0, 5).replace(":", "h");

  let jour = "";
  if (y && m && d) {
    const parsed = new Date(`${ymd}T12:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) jour = JOURS[parsed.getUTCDay()];
  }

  const quand = [jour, y && m && d ? `${d}/${m}` : ymd, hhmm]
    .filter(Boolean)
    .join(" ");
  const room = String(slot.room || "").trim();
  return room ? `${quand} — salle ${room}` : quand;
}

/** "a, b et 3 autres" — liste tronquée, lisible dans un corps de notification. */
function joinLabels(slots: UnderstaffedSlot[]): string {
  const labels = slots.slice(0, MAX_LISTED).map(formatSlotLabel);
  const rest = slots.length - labels.length;
  const listed = labels.join(", ");
  return rest > 0
    ? `${listed} et ${rest} autre${rest > 1 ? "s" : ""}`
    : listed;
}

/**
 * Les deux alertes à envoyer à TOUS les examinateurs, à partir des créneaux
 * en sous-effectif AYANT des candidats inscrits.
 *
 * Deux notifications distinctes, jamais fusionnées : un créneau à 1 examinateur
 * peut se tenir, un créneau à 0 ne peut pas. Les noyer ensemble ferait passer
 * le second pour un simple manque de confort.
 *
 * Renvoie un tableau vide s'il n'y a rien à signaler — l'appelant n'a aucun cas
 * particulier à traiter.
 */
export function buildUnderstaffedNotifications(
  slots: UnderstaffedSlot[],
): DispatchNotification[] {
  const withCandidates = slots.filter((s) => s.candidates > 0);
  const partial = withCandidates.filter((s) => s.assigned >= 1);
  const empty = withCandidates.filter((s) => s.assigned === 0);

  const out: DispatchNotification[] = [];

  if (partial.length > 0) {
    const n = partial.length;
    out.push({
      type: "slot_understaffed",
      title: "Créneaux à compléter",
      body:
        `${n} créneau${n > 1 ? "x" : ""} avec des candidats inscrits ` +
        `n'${n > 1 ? "ont" : "a"} plus assez d'examinateurs : ${joinLabels(partial)}. ` +
        "Ajoutez vos disponibilités si vous pouvez en prendre un.",
      link: AVAILABILITY_LINK,
    });
  }

  if (empty.length > 0) {
    const n = empty.length;
    out.push({
      type: "slot_no_examiner",
      title: "⚠️ CRITIQUE — candidat sans examinateur",
      body:
        `${n} créneau${n > 1 ? "x" : ""} ${n > 1 ? "ont" : "a"} un candidat inscrit ` +
        `et AUCUN examinateur : ${joinLabels(empty)}. ` +
        "Ces créneaux ne peuvent pas se tenir en l'état.",
      link: AVAILABILITY_LINK,
    });
  }

  return out;
}
