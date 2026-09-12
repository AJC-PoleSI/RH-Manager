/**
 * Salles proposées pour déplacer un créneau (modale de détail du planning).
 *
 * Une salle n'est pas « libre » parce qu'aucun créneau n'y existe : avec le
 * modèle des ouvertures, TOUTE salle ouverte à cet horaire porte déjà un
 * créneau. Se contenter de l'anti-chevauchement reviendrait donc à ne proposer
 * que les salles FERMÉES à cette heure-là — l'inverse de ce qu'on cherche.
 *
 * D'où trois états au lieu de deux :
 *   • libre     — rien dans cette salle sur cet horaire ;
 *   • échange   — un créneau VIDE au même horaire : on échange les deux salles,
 *                 personne n'est déplacé, les deux ouvertures gardent leur
 *                 créneau (cf. PUT /api/slots/[id]) ;
 *   • occupée   — quelqu'un y est attendu, ou le créneau qui gêne n'a pas le
 *                 même horaire : l'échange ne s'applique pas, on refuse.
 *
 * Le créneau déplacé est exclu du calcul — sans quoi sa propre salle
 * s'afficherait occupée, par lui-même.
 */

export interface RoomChoiceSlot {
  id?: string;
  room?: string | null;
  date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  members?: unknown[] | null;
  enrollments?: unknown[] | null;
}

export interface RoomChoice {
  room: string;
  /** Déplacement refusé : quelqu'un est attendu là, ou l'horaire ne coïncide pas. */
  busy: boolean;
  /** Déplacement possible, mais par échange avec le créneau vide qui s'y trouve. */
  swap: boolean;
}

export interface RoomChoices {
  /** Salles utilisées le jour même — le déplacement se fait presque toujours là. */
  day: RoomChoice[];
  /** Salles connues du planning, mais pas utilisées ce jour-là. */
  others: string[];
}

const EMPTY: RoomChoices = { day: [], others: [] };

function toMinutes(time: string | null | undefined): number {
  const [h, m] = String(time || "")
    .slice(0, 5)
    .split(":")
    .map(Number);
  return (h || 0) * 60 + (m || 0);
}

function dayOf(date: string | null | undefined): string {
  return String(date || "").substring(0, 10);
}

/** Personne n'est attendu sur ce créneau : ni examinateur affecté, ni inscrit. */
export function isEmptySlot(slot: RoomChoiceSlot): boolean {
  return (slot.members || []).length === 0 && (slot.enrollments || []).length === 0;
}

export function roomChoicesForSlot(
  allSlots: RoomChoiceSlot[] | null | undefined,
  slot: RoomChoiceSlot | null | undefined,
): RoomChoices {
  if (!slot) return EMPTY;

  const day = dayOf(slot.date);
  const start = toMinutes(slot.start_time);
  const end = toMinutes(slot.end_time);

  const overlapsByRoom = new Map<string, RoomChoiceSlot[]>();
  const otherRooms = new Set<string>();

  for (const other of allSlots || []) {
    const room = String(other.room || "").trim();
    if (!room) continue;
    if (dayOf(other.date) !== day) {
      otherRooms.add(room);
      continue;
    }
    if (!overlapsByRoom.has(room)) overlapsByRoom.set(room, []);
    if (other.id === slot.id) continue;
    if (toMinutes(other.start_time) < end && start < toMinutes(other.end_time)) {
      overlapsByRoom.get(room)!.push(other);
    }
  }

  const byName = (a: string, b: string) =>
    a.localeCompare(b, "fr", { numeric: true });

  const day_ = Array.from(overlapsByRoom.entries())
    .map(([room, overlaps]) => {
      if (overlaps.length === 0) return { room, busy: false, swap: false };
      // L'échange ne vaut que contre UN seul créneau, vide, exactement sur le
      // même horaire : c'est la seule configuration où permuter les salles ne
      // déplace personne et ne peut pas créer de chevauchement ailleurs.
      const only = overlaps[0];
      const swappable =
        overlaps.length === 1 &&
        isEmptySlot(only) &&
        toMinutes(only.start_time) === start &&
        toMinutes(only.end_time) === end;
      return { room, busy: !swappable, swap: swappable };
    })
    .sort((a, b) => byName(a.room, b.room));

  return {
    day: day_,
    others: Array.from(otherRooms)
      .filter((room) => !overlapsByRoom.has(room))
      .sort(byName),
  };
}
