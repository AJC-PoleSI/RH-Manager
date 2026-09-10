import { supabaseAdmin } from "@/lib/supabase";

// Helper partagé d'anti-chevauchement de créneaux dans une même salle.
// Utilisé par TOUTES les routes qui créent ou déplacent des créneaux
// (création unitaire, bulk-create, publish, modification d'horaire) pour
// garantir qu'une salle ne peut jamais avoir deux créneaux superposés.

export interface RoomInterval {
  startMin: number;
  endMin: number;
  room: string;
  slotId?: string;
}

export function timeToMinutes(timeStr: string): number {
  const [h, m] = String(timeStr).slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Normalise un nom de salle pour la comparaison ("Salle 1 " ≡ "salle 1"). */
export function normalizeRoom(room: string | null | undefined): string {
  return String(room || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Bornes UTC d'un jour calendaire "YYYY-MM-DD", calculées explicitement
 * (Date.UTC) pour ne jamais dépendre du fuseau du serveur.
 *
 * `evaluation_slots.date` est stocké à midi HEURE LOCALE convertie en UTC
 * (cf. slotInsertRow : `new Date(dateStr + "T12:00:00").toISOString()`) — pour
 * le fuseau de l'appli (Europe/Paris, UTC+1/+2), ça tombe toujours entre
 * 10h et 11h UTC, donc largement à l'intérieur de ces bornes.
 */
function dayRangeUTC(dateStr: string): { start: string; end: string } {
  const [y, m, d] = dateStr.split("-").map(Number);
  return {
    start: new Date(Date.UTC(y, (m || 1) - 1, d || 1, 0, 0, 0, 0)).toISOString(),
    end: new Date(Date.UTC(y, (m || 1) - 1, d || 1, 23, 59, 59, 999)).toISOString(),
  };
}

/**
 * Charge tous les créneaux existants d'une journée (toutes épreuves
 * confondues) sous forme d'intervalles par salle normalisée.
 */
export async function fetchDayIntervals(
  dateStr: string,
): Promise<Map<string, RoomInterval[]>> {
  // BUG (trouvé en test local le 10/09/2026) : `.like("date", "${dateStr}%")`
  // sur une colonne `timestamptz` fait échouer la requête à coup sûr
  // ("operator does not exist: timestamp with time zone ~~ unknown") — et
  // l'erreur était silencieusement ignorée (seul `data` était déstructuré),
  // donc `fetchDayIntervals` renvoyait TOUJOURS une Map vide. Résultat :
  // AUCUNE des routes qui créent/déplacent des créneaux (openings, slots,
  // bulk-create, publish, duplicate) ne détectait jamais le moindre
  // chevauchement de salle — un doublon (double-clic, retry réseau,
  // re-soumission) créait silencieusement des créneaux en plus.
  const { start, end } = dayRangeUTC(dateStr);
  const { data, error } = await supabaseAdmin
    .from("evaluation_slots")
    .select("id, room, start_time, end_time")
    .gte("date", start)
    .lte("date", end);
  if (error) throw error;

  const byRoom = new Map<string, RoomInterval[]>();
  for (const s of (data as any[]) || []) {
    const key = normalizeRoom(s.room);
    if (!key) continue;
    if (!byRoom.has(key)) byRoom.set(key, []);
    byRoom.get(key)!.push({
      startMin: timeToMinutes(s.start_time),
      endMin: timeToMinutes(s.end_time),
      room: s.room,
      slotId: s.id,
    });
  }
  return byRoom;
}

/**
 * Cherche un conflit pour un intervalle (salle, début, fin) contre les
 * intervalles existants. `excludeSlotId` permet d'ignorer le créneau en
 * cours de modification.
 */
export function findConflict(
  intervals: Map<string, RoomInterval[]>,
  room: string,
  startMin: number,
  endMin: number,
  excludeSlotId?: string,
): RoomInterval | null {
  const list = intervals.get(normalizeRoom(room)) || [];
  for (const it of list) {
    if (excludeSlotId && it.slotId === excludeSlotId) continue;
    if (startMin < it.endMin && it.startMin < endMin) return it;
  }
  return null;
}

/**
 * Ajoute un intervalle au cache local (pour détecter aussi les conflits
 * internes à un même batch de création).
 */
export function addInterval(
  intervals: Map<string, RoomInterval[]>,
  room: string,
  startMin: number,
  endMin: number,
): void {
  const key = normalizeRoom(room);
  if (!key) return;
  if (!intervals.has(key)) intervals.set(key, []);
  intervals.get(key)!.push({ startMin, endMin, room });
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
