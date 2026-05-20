import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";

function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + (m || 0);
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// POST /api/slots/bulk-create — Admin only
// Accepts either :
//   { epreuveId, date, startTime, count, rooms }    → packs N slots starting at startTime
//   { epreuveId, date, startTime, endTime, rooms }  → fills the range (back-compat)
//
// Rules :
//   - Time range is FIXED — never auto-shrunk
//   - First slot starts exactly at startTime
//   - Slots are spaced by (duration + roulement) start-to-start
//   - end_time stored = start + duration ONLY (roulement is implicit spacing)
//   - If count × spacing exceeds the range → 400 error
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload || !payload.isAdmin) return forbidden();

  try {
    const body = await req.json();
    const { epreuveId, date, startTime, endTime, count, rooms } = body;

    if (!epreuveId || !date || !startTime || !rooms || rooms.length === 0) {
      return Response.json(
        { error: "epreuveId, date, startTime, rooms requis" },
        { status: 400 },
      );
    }

    const { data: epreuve, error: epreuveError } = await supabaseAdmin
      .from("epreuves")
      .select("*")
      .eq("id", epreuveId)
      .single();

    if (epreuveError || !epreuve) {
      return Response.json({ error: "Épreuve introuvable" }, { status: 404 });
    }

    const duration = epreuve.duration_minutes || 30;
    const roulement = epreuve.roulement_minutes ?? 10;
    const spacing = duration + roulement;
    const minMembers = epreuve.min_evaluators_per_salle ?? 2;
    const tour = epreuve.tour || 1;

    const startMin = timeToMinutes(startTime);

    // Mode determination
    let nSlots: number;
    let rangeEndMin: number | null = null;

    if (typeof count === "number" && count > 0) {
      nSlots = count;
      rangeEndMin = endTime ? timeToMinutes(endTime) : null;
    } else if (endTime) {
      rangeEndMin = timeToMinutes(endTime);
      // Max N such that start + (N-1)*spacing + duration <= rangeEndMin
      nSlots = Math.max(
        0,
        Math.floor((rangeEndMin - startMin - duration) / spacing) + 1,
      );
    } else {
      return Response.json(
        { error: "Préciser count ou endTime" },
        { status: 400 },
      );
    }

    if (nSlots <= 0) {
      return Response.json({ error: "Aucun créneau possible" }, { status: 400 });
    }

    // Range fit check
    if (rangeEndMin !== null) {
      const lastSlotEnd = startMin + (nSlots - 1) * spacing + duration;
      if (lastSlotEnd > rangeEndMin) {
        const maxFit = Math.max(
          0,
          Math.floor((rangeEndMin - startMin - duration) / spacing) + 1,
        );
        return Response.json(
          {
            error: `Trop de créneaux pour la plage ${startTime}–${endTime} : ${nSlots} demandés, ${maxFit} max (${duration}+${roulement}min/créneau).`,
          },
          { status: 400 },
        );
      }
    }

    const dateFormatted = new Date(date + "T12:00:00").toISOString();
    const dateStr = (date + "T12:00:00").split("T")[0]; // YYYY-MM-DD format
    const slotsToInsert: any[] = [];

    // ────────────────────────────────────────────────────────────────
    // Check for existing slots in each room on the given date
    // to prevent overlaps when generating new slots
    // ────────────────────────────────────────────────────────────────
    const existingSlotsByRoom: { [roomId: string]: Array<{ startMin: number; endMin: number }> } = {};

    for (const room of rooms) {
      const roomLabel = `Salle ${room}`;
      const { data: existingSlots } = await supabaseAdmin
        .from("evaluation_slots")
        .select("start_time, end_time")
        .eq("room", roomLabel)
        .like("date", `${dateStr}%`);

      existingSlotsByRoom[roomLabel] = (existingSlots || []).map((slot: any) => ({
        startMin: timeToMinutes(slot.start_time),
        endMin: timeToMinutes(slot.end_time),
      }));
    }

    // ────────────────────────────────────────────────────────────────
    // Generate slots and check for overlaps
    // ────────────────────────────────────────────────────────────────
    for (let i = 0; i < nSlots; i++) {
      const slotStartMin = startMin + i * spacing;
      const slotEndMin = slotStartMin + duration; // end = start + duration
      const slotStart = minutesToTime(slotStartMin);
      const slotEnd = minutesToTime(slotEndMin);

      for (const room of rooms) {
        const roomLabel = `Salle ${room}`;
        const existingSlots = existingSlotsByRoom[roomLabel] || [];

        // Check if this generated slot overlaps with any existing slot in this room
        const hasOverlap = existingSlots.some(
          (existing) => slotStartMin < existing.endMin && existing.startMin < slotEndMin,
        );

        if (hasOverlap) {
          return Response.json(
            {
              error: `Chevauchement détecté pour ${roomLabel} : le créneau ${slotStart}–${slotEnd} chevauche un créneau existant.`,
            },
            { status: 400 },
          );
        }

        slotsToInsert.push({
          date: dateFormatted,
          start_time: slotStart,
          end_time: slotEnd,
          duration_minutes: duration,
          label: null,
          max_candidates: epreuve.is_group_epreuve ? epreuve.group_size || 1 : 1,
          min_members: minMembers,
          simultaneous_slots: 1,
          epreuve_id: epreuveId,
          tour,
          room: roomLabel,
          status: "draft",
        });
      }
    }

    const { data: createdSlots, error: insertError } = await supabaseAdmin
      .from("evaluation_slots")
      .insert(slotsToInsert)
      .select("*");

    if (insertError) throw insertError;

    return Response.json(
      {
        message: "Success",
        count: createdSlots.length,
        per_day: nSlots,
        slots: createdSlots,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Bulk create error:", error);
    return Response.json(
      { error: "Échec génération", details: String(error) },
      { status: 500 },
    );
  }
}
