import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import {
  fetchDayIntervals,
  findConflict,
  addInterval,
  timeToMinutes,
  minutesToTime,
  type RoomInterval,
} from "@/lib/slot-conflicts";
import { NextRequest } from "next/server";

// POST /api/slots/publish — publish generated slots to DB (admin)
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const { epreuveId, slots } = await req.json();

    if (!epreuveId || !slots || !Array.isArray(slots)) {
      return Response.json(
        { error: "epreuveId and slots array required" },
        { status: 400 },
      );
    }

    // Verify epreuve exists
    const { data: epreuve, error: epreuveError } = await supabaseAdmin
      .from("epreuves")
      .select("*")
      .eq("id", epreuveId)
      .single();

    if (epreuveError || !epreuve) {
      return Response.json({ error: "Epreuve not found" }, { status: 404 });
    }

    const createdSlots = [];
    const skippedConflicts: string[] = [];
    // Cache des intervalles par jour (anti-chevauchement par salle)
    const intervalsByDay = new Map<string, Map<string, RoomInterval[]>>();

    for (const slot of slots) {
      for (const room of slot.rooms) {
        const roomLabel = room.roomLabel || `Salle ${room.roomNumber}`;

        // ── Anti-chevauchement : ignorer (et signaler) tout créneau qui
        // se superpose à un créneau existant dans la même salle ce jour-là.
        if (!intervalsByDay.has(slot.date)) {
          intervalsByDay.set(slot.date, await fetchDayIntervals(slot.date));
        }
        const dayIntervals = intervalsByDay.get(slot.date)!;
        const sMin = timeToMinutes(slot.startTime);
        const eMin = timeToMinutes(slot.endTime);
        const overlap = findConflict(dayIntervals, roomLabel, sMin, eMin);
        if (overlap) {
          skippedConflicts.push(
            `${slot.date} ${slot.startTime}–${slot.endTime} (${roomLabel}) en conflit avec ${minutesToTime(overlap.startMin)}–${minutesToTime(overlap.endMin)}`,
          );
          continue;
        }
        addInterval(dayIntervals, roomLabel, sMin, eMin);

        // Create the slot
        const { data: created, error: createError } = await supabaseAdmin
          .from("evaluation_slots")
          .insert({
            epreuve_id: epreuveId,
            date: new Date(slot.date + "T12:00:00").toISOString(),
            start_time: slot.startTime,
            end_time: slot.endTime,
            room: roomLabel,
            max_candidates: room.maxCandidates || 1,
            min_members: 1,
            status: "open",
            tour: epreuve.tour,
          })
          .select()
          .single();

        if (createError) throw createError;

        // Assign members
        if (room.members && room.members.length > 0) {
          const memberRows = room.members.map((m: any) => ({
            slot_id: created.id,
            member_id: m.id,
          }));

          const { error: memberError } = await supabaseAdmin
            .from("slot_member_assignments")
            .insert(memberRows);

          if (memberError) throw memberError;
        }

        // Re-fetch with members for response
        const { data: fullSlot } = await supabaseAdmin
          .from("evaluation_slots")
          .select(
            `
            *,
            members:slot_member_assignments(*, member:members(email))
          `,
          )
          .eq("id", created.id)
          .single();

        createdSlots.push(fullSlot);
      }
    }

    return Response.json({
      success: true,
      count: createdSlots.length,
      skipped_conflicts: skippedConflicts.length,
      conflicts: skippedConflicts,
      message:
        skippedConflicts.length > 0
          ? `${createdSlots.length} créneau(x) créé(s) · ${skippedConflicts.length} ignoré(s) pour cause de chevauchement de salle`
          : undefined,
      slots: createdSlots,
    });
  } catch (error) {
    console.error("Publish slots error:", error);
    return Response.json(
      { error: "Failed to publish slots", details: String(error) },
      { status: 500 },
    );
  }
}
