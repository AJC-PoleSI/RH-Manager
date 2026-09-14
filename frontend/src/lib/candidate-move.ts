/**
 * candidate-move — Déplacer un candidat d'un créneau à un autre (admin).
 *
 * POURQUOI UNE DÉCISION À PART
 * ────────────────────────────
 * L'inscription candidate (`/api/slots/enroll`) est gouvernée par des règles
 * qui protègent le CANDIDAT de lui-même : préavis de 24h, date limite de
 * l'épreuve, tour ouvert, planning publié. Un admin qui rattrape une erreur de
 * planning n'a que faire de ces garde-fous — il agit justement parce que la
 * situation est anormale.
 *
 * Restent DEUX règles qui ne sont pas des garde-fous mais des impossibilités
 * physiques ou organisationnelles, et que l'admin doit voir avant de forcer :
 *   - le candidat ne peut pas être à deux endroits en même temps ;
 *   - une salle a une capacité.
 *
 * Et UNE conséquence automatique : s'inscrire sur un créneau d'une épreuve
 * qu'on tient déjà ailleurs, c'est un DÉPLACEMENT, pas une seconde
 * inscription. L'ancienne inscription est libérée sans rien demander — c'est
 * l'intention même du geste « changer ce candidat de créneau ».
 *
 * Ce module ne décide que du PLAN. Les écritures (suppression, insertion,
 * verrous, notifications) restent dans la route.
 */
import { isActiveEnrollment, type EnrollmentStatus } from "./enrollment";
import { timeOverlaps } from "./dispatch-core";

/** Ce qu'il faut savoir d'un créneau pour raisonner sur un déplacement. */
export interface MoveSlotRef {
  id: string;
  date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  room?: string | null;
  epreuve_id?: string | null;
  epreuve_name?: string | null;
}

/** Une inscription du candidat, avec le créneau qu'elle occupe. */
export interface MoveEnrollment {
  id: string;
  status?: EnrollmentStatus;
  slot: MoveSlotRef | null;
}

export interface MoveInput {
  /** Créneau d'arrivée. */
  target: MoveSlotRef;
  /** TOUTES les inscriptions du candidat, épreuves confondues (cible incluse). */
  enrollments: MoveEnrollment[];
  /** Capacité effective du créneau d'arrivée (cf. effectiveMaxCandidates). */
  capacity: number;
  /** Inscrits actifs déjà présents sur le créneau d'arrivée. */
  occupied: number;
  /** L'admin a confirmé : passer outre « complet » et « déjà pris ailleurs ». */
  force?: boolean;
}

export type MovePlan =
  /** Le candidat y est déjà : rien à faire. */
  | { ok: true; alreadyHere: true; release: MoveEnrollment[]; from: null }
  /** À exécuter : libérer `release`, puis inscrire sur la cible. */
  | { ok: true; alreadyHere: false; release: MoveEnrollment[]; from: MoveSlotRef | null }
  /** Refus — `force: true` lèverait le blocage. */
  | {
      ok: false;
      code: "SLOT_FULL" | "TIME_CONFLICT";
      message: string;
      conflict?: MoveSlotRef;
    };

const hhmm = (v: unknown) => String(v ?? "").substring(0, 5);
const day = (v: unknown) => String(v ?? "").substring(0, 10);

/** « mardi 15 septembre 08:30–08:55 (salle 205) » — lisible dans un message. */
export function describeSlot(s: MoveSlotRef | null | undefined): string {
  if (!s) return "un autre créneau";
  const d = day(s.date);
  const dateLabel = d
    ? new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : "";
  const start = hhmm(s.start_time);
  const end = hhmm(s.end_time);
  const time = start ? `${start}${end ? `–${end}` : ""}` : "";
  const room = s.room ? `(salle ${s.room})` : "";
  const label = [dateLabel, time, room].filter(Boolean).join(" ");
  return label || "un autre créneau";
}

/** Deux créneaux se chevauchent-ils ? (même jour + intersection horaire) */
function overlaps(a: MoveSlotRef, b: MoveSlotRef): boolean {
  if (!a.date || !b.date) return false;
  if (day(a.date) !== day(b.date)) return false;
  const aStart = hhmm(a.start_time);
  const bStart = hhmm(b.start_time);
  if (!aStart || !bStart) return false;
  return timeOverlaps(aStart, hhmm(a.end_time) || aStart, bStart, hhmm(b.end_time) || bStart);
}

/**
 * Que faut-il faire pour poser ce candidat sur ce créneau ?
 *
 * L'ordre des vérifications compte : les inscriptions libérées d'office
 * (même épreuve) sont écartées AVANT le test de chevauchement — déplacer un
 * candidat de la salle 204 à la salle 210 au même horaire ne doit pas être
 * refusé au motif qu'il est « déjà pris » par le créneau qu'on lui retire.
 */
export function planCandidateMove(input: MoveInput): MovePlan {
  const actives = input.enrollments.filter(
    (e) => isActiveEnrollment(e.status) && e.slot,
  );

  if (actives.some((e) => e.slot!.id === input.target.id)) {
    return { ok: true, alreadyHere: true, release: [], from: null };
  }

  const others = actives.filter((e) => e.slot!.id !== input.target.id);

  // Même épreuve ailleurs → c'est le créneau qu'on quitte.
  const sameEpreuve = input.target.epreuve_id
    ? others.filter((e) => e.slot!.epreuve_id === input.target.epreuve_id)
    : [];
  const sameIds = new Set(sameEpreuve.map((e) => e.id));

  // Reste : d'autres épreuves. Un chevauchement y est un vrai conflit.
  const clashes = others.filter(
    (e) => !sameIds.has(e.id) && overlaps(input.target, e.slot!),
  );

  if (!input.force) {
    if (input.occupied >= input.capacity) {
      return {
        ok: false,
        code: "SLOT_FULL",
        message:
          input.capacity === 0
            ? "Ce créneau n'a aucun examinateur : sa capacité est nulle."
            : `Ce créneau est complet (${input.occupied}/${input.capacity}).`,
      };
    }
    if (clashes.length > 0) {
      const c = clashes[0].slot!;
      const epreuve = c.epreuve_name ? ` — ${c.epreuve_name}` : "";
      return {
        ok: false,
        code: "TIME_CONFLICT",
        message: `Ce candidat est déjà attendu sur un créneau qui chevauche cet horaire : ${describeSlot(c)}${epreuve}.`,
        conflict: c,
      };
    }
  }

  const release = [...sameEpreuve, ...(input.force ? clashes : [])];
  return {
    ok: true,
    alreadyHere: false,
    release,
    from: sameEpreuve[0]?.slot ?? null,
  };
}
