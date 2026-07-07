// Helpers Supabase partagés par les routes /api/openings*.
// La logique pure (découpage, diff) vit dans opening-slicer.ts.
import { supabaseAdmin } from "@/lib/supabase";
import {
  fetchDayIntervals,
  findConflict,
  timeToMinutes,
  minutesToTime,
} from "@/lib/slot-conflicts";
import { sliceOpening, SlotTime, ExistingSlot } from "@/lib/opening-slicer";

export interface OpeningRow {
  id: string;
  epreuve_id: string;
  room: string;
  date: string; // YYYY-MM-DD
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
}

export function sliceParamsFromEpreuve(epreuve: any) {
  return {
    durationMinutes: epreuve.duration_minutes || 30,
    roulementMinutes: epreuve.roulement_minutes ?? 10,
  };
}

export function sliceOpeningRow(
  o: {
    start_time: string;
    end_time: string;
    break_start?: string | null;
    break_end?: string | null;
  },
  epreuve: any,
): SlotTime[] {
  return sliceOpening(
    {
      startTime: o.start_time,
      endTime: o.end_time,
      breakStart: o.break_start,
      breakEnd: o.break_end,
    },
    sliceParamsFromEpreuve(epreuve),
  );
}

/** Ligne d'insertion evaluation_slots pour un horaire découpé (mêmes défauts que bulk-create). */
export function slotInsertRow(
  t: SlotTime,
  dateStr: string,
  room: string,
  epreuve: any,
  openingId: string,
) {
  return {
    date: new Date(dateStr + "T12:00:00").toISOString(),
    start_time: t.startTime,
    end_time: t.endTime,
    duration_minutes: epreuve.duration_minutes || 30,
    label: null,
    max_candidates: epreuve.is_group_epreuve ? epreuve.group_size || 1 : 1,
    min_members: epreuve.min_evaluators_per_salle ?? 2,
    simultaneous_slots: 1,
    epreuve_id: epreuve.id,
    tour: epreuve.tour || 1,
    room,
    status: "draft",
    opening_id: openingId,
  };
}

/**
 * Vérifie qu'une ouverture (salle + date + plage) ne chevauche aucun
 * créneau existant de la même salle ce jour-là (toutes épreuves),
 * en ignorant les créneaux `excludeSlotIds` (ceux de l'ouverture modifiée).
 * Retourne un message d'erreur français, ou null si OK.
 */
export async function checkOpeningOverlap(
  dateStr: string,
  room: string,
  startTime: string,
  endTime: string,
  excludeSlotIds: string[] = [],
): Promise<string | null> {
  const intervals = await fetchDayIntervals(dateStr);
  const exclude = new Set(excludeSlotIds);
  for (const [key, list] of Array.from(intervals.entries())) {
    intervals.set(
      key,
      list.filter((it) => !it.slotId || !exclude.has(it.slotId)),
    );
  }
  const overlap = findConflict(
    intervals,
    room,
    timeToMinutes(startTime),
    timeToMinutes(endTime),
  );
  return overlap
    ? `Chevauchement : la salle « ${overlap.room} » a déjà un créneau ${minutesToTime(overlap.startMin)}–${minutesToTime(overlap.endMin)} le ${dateStr}.`
    : null;
}

export function isSlotOccupied(s: any): boolean {
  const activeEnrollments = (s.enrollments || []).filter(
    (e: any) => !e.status || e.status === "active",
  );
  return (s.members || []).length > 0 || activeEnrollments.length > 0;
}

export type OpeningSlot = ExistingSlot & { raw: any };

/** Charge les créneaux d'une ouverture avec leur occupation. */
export async function fetchOpeningSlots(
  openingId: string,
): Promise<OpeningSlot[]> {
  const { data } = await supabaseAdmin
    .from("evaluation_slots")
    .select(
      `id, date, start_time, end_time, room, status,
       members:slot_member_assignments(id),
       enrollments:slot_enrollments(id, status, candidate_id)`,
    )
    .eq("opening_id", openingId);

  return ((data as any[]) || []).map((s) => ({
    id: s.id,
    date: String(s.date).split("T")[0],
    start_time: String(s.start_time).slice(0, 5),
    end_time: String(s.end_time).slice(0, 5),
    occupied: isSlotOccupied(s),
    raw: s,
  }));
}

/** Notifie les candidats inscrits de créneaux supprimés (même mécanique que le reset). */
export async function notifySlotDeletion(slots: any[]): Promise<number> {
  const rows: any[] = [];
  for (const s of slots) {
    const enrollments = (s.enrollments || []).filter(
      (e: any) => (!e.status || e.status === "active") && e.candidate_id,
    );
    if (enrollments.length === 0) continue;
    const dateStr = s.date
      ? new Date(s.date).toLocaleDateString("fr-FR", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })
      : "";
    const startTime = String(s.start_time || "").substring(0, 5);
    for (const e of enrollments) {
      rows.push({
        sender_id: null,
        sender_role: "admin",
        sender_name: "Système",
        recipient_id: e.candidate_id,
        recipient_role: "candidate",
        message: `⚠️ Votre créneau du ${dateStr} à ${startTime} (salle ${s.room || "—"}) a été annulé par l'administration. Merci de vous réinscrire à un autre créneau disponible.`,
      });
    }
  }
  if (rows.length > 0) {
    try {
      await supabaseAdmin.from("private_messages").insert(rows);
    } catch (e) {
      console.error("Notification suppression créneaux échec:", e);
    }
  }
  return rows.length;
}

/** Supprime des créneaux par ids (mêmes cascades explicites que le reset). */
export async function deleteSlotsByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await supabaseAdmin.from("slot_enrollments").delete().in("slot_id", ids);
  await supabaseAdmin
    .from("slot_member_assignments")
    .delete()
    .in("slot_id", ids);
  try {
    await supabaseAdmin
      .from("slot_availability_requests")
      .delete()
      .in("slot_id", ids);
  } catch {
    // la table peut ne pas exister sur certains environnements
  }
  await supabaseAdmin.from("evaluation_slots").delete().in("id", ids);
}

const HHMM = /^\d{2}:\d{2}$/;

/**
 * Valide les champs d'une ouverture. Retourne un message d'erreur
 * français, ou null si tout est valide.
 */
export function validateOpeningInput(o: {
  room?: string;
  date?: string;
  start_time?: string;
  end_time?: string;
  break_start?: string | null;
  break_end?: string | null;
}): string | null {
  if (!o.room || !String(o.room).trim()) return "La salle est requise.";
  if (!o.date || !/^\d{4}-\d{2}-\d{2}$/.test(String(o.date)))
    return "La date est requise (format AAAA-MM-JJ).";
  if (!o.start_time || !HHMM.test(String(o.start_time)))
    return "Heure de début invalide (format HH:MM).";
  if (!o.end_time || !HHMM.test(String(o.end_time)))
    return "Heure de fin invalide (format HH:MM).";
  if (o.start_time >= o.end_time)
    return "L'heure de début doit précéder l'heure de fin.";
  const hasBs = !!o.break_start;
  const hasBe = !!o.break_end;
  if (hasBs !== hasBe)
    return "La pause doit avoir un début ET une fin (ou aucun des deux).";
  if (hasBs && hasBe) {
    if (!HHMM.test(String(o.break_start)) || !HHMM.test(String(o.break_end)))
      return "Horaires de pause invalides (format HH:MM).";
    if ((o.break_start as string) >= (o.break_end as string))
      return "Le début de pause doit précéder la fin de pause.";
    if (
      (o.break_start as string) < o.start_time ||
      (o.break_end as string) > o.end_time
    )
      return "La pause doit être comprise dans la plage horaire.";
  }
  return null;
}
