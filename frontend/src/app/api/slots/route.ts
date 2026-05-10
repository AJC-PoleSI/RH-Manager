import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";

// POST /api/slots — create a slot (admin)
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const {
      date,
      startTime,
      endTime,
      durationMinutes,
      label,
      maxCandidates,
      minMembers,
      simultaneousSlots,
      epreuveId,
      tour,
      room,
    } = await req.json();

    if (!date || !startTime) {
      return Response.json(
        { error: "date et startTime sont requis" },
        { status: 400 },
      );
    }

    // ══════════════════════════════════════════════════════════════════
    // Si une épreuve est liée, calculer la durée : épreuve + 10min buffer
    // ══════════════════════════════════════════════════════════════════
    const BUFFER_MINUTES = 10;
    let computedDuration = durationMinutes || 60;
    let computedEndTime = endTime;

    if (epreuveId) {
      const { data: ep } = await supabaseAdmin
        .from("epreuves")
        .select("duration_minutes")
        .eq("id", epreuveId)
        .single();
      if (ep?.duration_minutes) {
        computedDuration = ep.duration_minutes + BUFFER_MINUTES;
        // Calculer end_time depuis start_time si pas fourni
        if (!endTime) {
          const [h, m] = startTime.split(":").map(Number);
          const totalMin = h * 60 + (m || 0) + computedDuration;
          computedEndTime = `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
        }
      }
    }

    if (!computedEndTime) {
      const [h, m] = startTime.split(":").map(Number);
      const totalMin = h * 60 + (m || 0) + computedDuration;
      computedEndTime = `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
    }

    const { data: slot, error } = await supabaseAdmin
      .from("evaluation_slots")
      .insert({
        date: new Date(date + "T12:00:00").toISOString(),
        start_time: startTime,
        end_time: computedEndTime,
        duration_minutes: computedDuration,
        label: label || null,
        max_candidates: maxCandidates || 1,
        min_members: minMembers || 1,
        simultaneous_slots: simultaneousSlots ?? 1,
        epreuve_id: epreuveId || null,
        tour: tour || 1,
        room: room || null,
        status: "open",
      })
      .select(
        `
        *,
        epreuve:epreuves(name, tour, type),
        members:slot_member_assignments(*, member:members(id, email)),
        enrollments:slot_enrollments(*, candidate:candidates(id, first_name, last_name)),
        requests:slot_availability_requests(*, member:members(id, email))
      `,
      )
      .single();

    if (error) throw error;

    return Response.json(slot, { status: 201 });
  } catch (error) {
    console.error("Create slot error:", error);
    return Response.json(
      { error: "Failed to create slot", details: String(error) },
      { status: 500 },
    );
  }
}
