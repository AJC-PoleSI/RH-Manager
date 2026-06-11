import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import {
  fetchDayIntervals,
  findConflict,
  minutesToTime as m2t,
} from "@/lib/slot-conflicts";
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
    // GUARD: every slot MUST be linked to an épreuve.
    // Avoids orphan slots polluting KPIs/planning. See "créneaux fantômes".
    // ══════════════════════════════════════════════════════════════════
    if (!epreuveId) {
      return Response.json(
        { error: "epreuveId est requis : un créneau doit être lié à une épreuve" },
        { status: 400 },
      );
    }

    // Verify the épreuve actually exists (prevents stale UUIDs)
    const { data: epreuveExists } = await supabaseAdmin
      .from("epreuves")
      .select("id")
      .eq("id", epreuveId)
      .maybeSingle();
    if (!epreuveExists) {
      return Response.json(
        { error: "Épreuve introuvable" },
        { status: 404 },
      );
    }

    // ══════════════════════════════════════════════════════════════════
    // Durée du créneau : on respecte ce que le client envoie (start→end).
    // L'éventuelle "roulement" est gérée par l'espacement entre créneaux
    // (cf bulk-create), pas par la durée stockée d'un créneau individuel.
    // ══════════════════════════════════════════════════════════════════
    let computedEndTime = endTime;

    if (!computedEndTime) {
      const fallbackDuration =
        durationMinutes && durationMinutes > 0 ? durationMinutes : 60;
      const [h, m] = startTime.split(":").map(Number);
      const totalMin = h * 60 + (m || 0) + fallbackDuration;
      computedEndTime = `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
    }

    // Durée stockée = différence réelle start → end (en minutes)
    const timeToMin = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + (m || 0);
    };
    const startMinVal = timeToMin(startTime);
    const endMinVal = timeToMin(computedEndTime);
    const computedDuration = Math.max(1, endMinVal - startMinVal);

    // ══════════════════════════════════════════════════════════════════
    // Anti-chevauchement : refuse un créneau qui se superpose à un autre
    // dans la même salle (noms normalisés), le même jour.
    // ══════════════════════════════════════════════════════════════════
    if (room) {
      const dateStr = date.split("T")[0];
      const intervals = await fetchDayIntervals(dateStr);
      const overlap = findConflict(intervals, room, startMinVal, endMinVal);
      if (overlap) {
        return Response.json(
          {
            error: `Chevauchement : ${overlap.room} a déjà un créneau ${m2t(overlap.startMin)}–${m2t(overlap.endMin)} ce jour-là.`,
          },
          { status: 409 },
        );
      }
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
        epreuve_id: epreuveId,
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
