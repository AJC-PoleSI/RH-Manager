// Accès base de l'épreuve sur table bloquante (logique pure dans
// epreuve-bloquante.ts).
import { supabaseAdmin } from "@/lib/supabase";
import { dayRangeUTC } from "@/lib/slot-conflicts";
import { isMissingColumnError } from "@/lib/slot-lock";
import {
  blockingWindowsOf,
  slotBlockedBy,
  type BlockingWindow,
} from "@/lib/epreuve-bloquante";

/**
 * Fenêtres bloquées par les épreuves sur table. Lue à chaque inscription :
 * seules les épreuves bloquantes (aucune, en temps normal) et les colonnes
 * utiles, pour ne pas peser sur l'egress Supabase. Tant que la migration
 * n'est pas appliquée, la colonne manque : rien ne bloque, comme avant.
 */
export async function fetchBlockingWindows(): Promise<BlockingWindow[]> {
  const { data, error } = await supabaseAdmin
    .from("epreuves")
    .select(
      "id, name, type, date_debut, heure_debut, duration_minutes, blocage_autres_epreuves",
    )
    .eq("type", "commune")
    .not("blocage_autres_epreuves", "is", null);
  if (error) {
    if (isMissingColumnError(error)) return [];
    throw error;
  }
  return blockingWindowsOf(data || []);
}

export interface BlockingPurgeResult {
  /** Créneaux vides supprimés (aucune inscription, même annulée). */
  deleted: number;
  /** Créneaux gardés parce qu'un candidat y est (ou y a été) inscrit, ou verrouillés. */
  kept: Array<{
    id: string;
    epreuve: string;
    date: string;
    start_time: string;
    end_time: string;
    room: string | null;
    enrolled: number;
  }>;
}

/**
 * Retire les créneaux des autres épreuves qui chevauchent la fenêtre.
 *
 * On ne désinscrit JAMAIS personne (règle de Felix, 08/10/2026) : seuls les
 * créneaux sans aucune ligne d'inscription et non verrouillés sont
 * supprimés. Les autres sont renvoyés pour que l'admin les déplace à la
 * main ; d'ici là, ils restent fermés à toute nouvelle inscription
 * (cf. /api/slots/enroll et /api/slots/available).
 */
export async function purgeSlotsInWindow(
  w: BlockingWindow,
): Promise<BlockingPurgeResult> {
  const { start, end } = dayRangeUTC(w.date);
  const { data, error } = await supabaseAdmin
    .from("evaluation_slots")
    .select(
      "*, epreuve:epreuves(name), enrollments:slot_enrollments(id, status)",
    )
    .gte("date", start)
    .lte("date", end);
  if (error) throw error;

  const inWindow = (data || []).filter(
    (s: any) => slotBlockedBy([w], s) !== null,
  );
  const free = inWindow.filter(
    (s: any) => (s.enrollments || []).length === 0 && s.is_locked !== true,
  );
  const kept = inWindow
    .filter((s: any) => !free.includes(s))
    .map((s: any) => ({
      id: s.id,
      epreuve: s.epreuve?.name || "Épreuve",
      date: String(s.date).split("T")[0],
      start_time: String(s.start_time).slice(0, 5),
      end_time: String(s.end_time).slice(0, 5),
      room: s.room ?? null,
      enrolled: (s.enrollments || []).filter(
        (e: any) => e.status !== "cancelled",
      ).length,
    }));

  if (free.length > 0) {
    const { error: delErr } = await supabaseAdmin
      .from("evaluation_slots")
      .delete()
      .in(
        "id",
        free.map((s: any) => s.id),
      );
    if (delErr) throw delErr;
  }
  return { deleted: free.length, kept };
}
