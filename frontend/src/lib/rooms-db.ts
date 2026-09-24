import { supabaseAdmin } from "@/lib/supabase";
import { getToursByNumber } from "@/lib/tour-status";
import { fetchAllRows } from "@/lib/supabase-paging";
import { DEFAULT_ROOMS, parseRoomList, serializeRoomList } from "@/lib/rooms";

// Accès base de la liste des salles (cf. lib/rooms.ts pour le format).

/** Liste déclarée, ou la liste par défaut si elle n'a jamais été enregistrée. */
export async function readRoomList(): Promise<{ rooms: string[]; declared: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("system_settings")
    .select("value")
    .eq("key", "rooms")
    .maybeSingle();
  if (error) throw error;
  const declared = parseRoomList(data?.value);
  return declared
    ? { rooms: declared, declared: true }
    : { rooms: DEFAULT_ROOMS, declared: false };
}

export async function writeRoomList(rooms: string[]): Promise<void> {
  const { error } = await supabaseAdmin
    .from("system_settings")
    .upsert({ key: "rooms", value: serializeRoomList(rooms) }, { onConflict: "key" });
  if (error) throw error;
}

/**
 * Épreuves des tours qui ne sont pas clos (« termine »). Renommer une salle
 * ne touche qu'elles : un tour clos garde les salles où il s'est réellement
 * passé. Une épreuve sans tour connu compte comme ouverte.
 */
export async function openEpreuveIds(): Promise<string[]> {
  const [tours, epreuvesRes] = await Promise.all([
    getToursByNumber(),
    fetchAllRows<{ id: string; tour: number | null }>((from, to) =>
      supabaseAdmin.from("epreuves").select("id, tour").order("id").range(from, to),
    ),
  ]);
  if (epreuvesRes.error) throw epreuvesRes.error;
  return (epreuvesRes.data || [])
    .filter((e) => tours[Number(e.tour)]?.status !== "termine")
    .map((e) => e.id);
}

/** Nombre d'ouvertures par salle, sur les épreuves données. */
export async function openingsPerRoom(epreuveIds: string[]): Promise<Record<string, number>> {
  if (epreuveIds.length === 0) return {};
  const { data, error } = await fetchAllRows<{ room: string | null }>((from, to) =>
    supabaseAdmin
      .from("room_openings")
      .select("room")
      .in("epreuve_id", epreuveIds)
      .order("id")
      .range(from, to),
  );
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const o of data || []) {
    if (o.room) counts[o.room] = (counts[o.room] ?? 0) + 1;
  }
  return counts;
}
