/**
 * Salles proposées pour déplacer un créneau (modale de détail du planning).
 *
 * Déplacer un créneau dans une salle déjà occupée à cet horaire est refusé par
 * le serveur (anti-chevauchement, cf. slot-conflicts.ts). Plutôt que de laisser
 * l'admin le découvrir par un 409, on marque ces salles « occupée » dans la
 * liste : la contrainte est visible avant le clic.
 *
 * Le créneau déplacé est exclu du calcul d'occupation — sans quoi sa propre
 * salle s'afficherait toujours occupée, par lui-même.
 */

export interface RoomChoiceSlot {
  id?: string;
  room?: string | null;
  date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
}

export interface RoomChoice {
  room: string;
  /** Une AUTRE occupation de cette salle chevauche l'horaire du créneau. */
  busy: boolean;
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

export function roomChoicesForSlot(
  allSlots: RoomChoiceSlot[] | null | undefined,
  slot: RoomChoiceSlot | null | undefined,
): RoomChoices {
  if (!slot) return EMPTY;

  const day = dayOf(slot.date);
  const start = toMinutes(slot.start_time);
  const end = toMinutes(slot.end_time);

  // Une salle peut porter plusieurs créneaux dans la journée : elle n'est
  // « occupée » que si l'un d'eux chevauche NOTRE horaire, d'où le OU cumulé.
  const dayRooms = new Map<string, boolean>();
  const otherRooms = new Set<string>();

  for (const other of allSlots || []) {
    const room = String(other.room || "").trim();
    if (!room) continue;
    if (dayOf(other.date) === day) {
      const busy =
        other.id !== slot.id &&
        toMinutes(other.start_time) < end &&
        start < toMinutes(other.end_time);
      dayRooms.set(room, (dayRooms.get(room) || false) || busy);
    } else {
      otherRooms.add(room);
    }
  }

  const byName = (a: string, b: string) =>
    a.localeCompare(b, "fr", { numeric: true });

  return {
    day: Array.from(dayRooms.entries())
      .map(([room, busy]) => ({ room, busy }))
      .sort((a, b) => byName(a.room, b.room)),
    others: Array.from(otherRooms)
      .filter((room) => !dayRooms.has(room))
      .sort(byName),
  };
}
