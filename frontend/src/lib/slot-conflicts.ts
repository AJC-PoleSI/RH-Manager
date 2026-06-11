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
 * Charge tous les créneaux existants d'une journée (toutes épreuves
 * confondues) sous forme d'intervalles par salle normalisée.
 */
export async function fetchDayIntervals(
  dateStr: string,
): Promise<Map<string, RoomInterval[]>> {
  const { data } = await supabaseAdmin
    .from("evaluation_slots")
    .select("id, room, start_time, end_time")
    .like("date", `${dateStr}%`);

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
