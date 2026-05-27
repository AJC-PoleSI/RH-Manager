import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { filterActiveEnrollments } from "@/lib/enrollment";
import { NextRequest } from "next/server";

// GET /api/calendar — get events with optional ?start=&end= date filters
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  try {
    let query = supabaseAdmin.from("calendar_events").select(`
        *,
        epreuve:epreuves(*),
        member:members(email),
        candidate:candidates(first_name, last_name)
      `);

    if (start && end) {
      const endDate = new Date(end);
      endDate.setHours(23, 59, 59, 999);

      query = query
        .gte("day", new Date(start).toISOString())
        .lte("day", endDate.toISOString());
    }

    const { data, error } = await query;
    if (error) throw error;

    // Filtrer : retourner les événements globaux + ceux assignés à l'utilisateur
    const userId = payload.id;
    const isCandidate = payload.role === "candidate";

    const filtered = (data || []).filter((event: any) => {
      // Événement global → visible par tous (sauf si masqué pour les candidats)
      if (event.is_global) {
        // Si candidat, vérifier la visibilité
        if (isCandidate && event.visible_to_candidates === false) return false;
        return true;
      }
      // FIX M2: an event without related_member/related_candidate is
      // ONLY visible to admins (was previously visible to everyone, which
      // accidentally leaked orphan events).
      if (!event.related_member_id && !event.related_candidate_id) {
        return !!payload.isAdmin;
      }
      // Événement assigné à cet utilisateur
      if (payload.role === "member" && event.related_member_id === userId)
        return true;
      if (isCandidate && event.related_candidate_id === userId)
        return true;
      // Admin voit tout
      if (payload.isAdmin) return true;
      return false;
    });

    // ═══════════════════════════════════════════════════════════════════
    // FIX C3: UNION evaluation_slots + slot_enrollments
    // The candidate's enrollment lives in `slot_enrollments`, not in
    // `calendar_events`. Without this union, admin/member calendar views
    // never saw the enrollment. We synthesize calendar_event-shaped rows
    // on the fly so the client doesn't need to change.
    // ═══════════════════════════════════════════════════════════════════
    let slotQ = supabaseAdmin
      .from("evaluation_slots")
      .select(
        `
        id, date, start_time, end_time, room, label, status, max_candidates,
        epreuve_id,
        epreuve:epreuves(id, name, tour, type),
        members:slot_member_assignments(member_id),
        enrollments:slot_enrollments(id, candidate_id, status, candidate:candidates(id, first_name, last_name))
      `,
      )
      .in("status", ["published", "ready", "full", "closed"]);

    if (start && end) {
      const startDate = new Date(start);
      startDate.setHours(0, 0, 0, 0);
      const endDate2 = new Date(end);
      endDate2.setHours(23, 59, 59, 999);
      slotQ = slotQ
        .gte("date", startDate.toISOString())
        .lte("date", endDate2.toISOString());
    }
    const { data: slotRows } = await slotQ;

    const slotEvents: any[] = [];
    for (const slot of (slotRows || []) as any[]) {
      if (!slot.epreuve) continue;
      const activeEnrolls = (slot.enrollments || []).filter(
        filterActiveEnrollments,
      );
      const isMemberOnSlot =
        payload.role === "member" &&
        (slot.members || []).some((m: any) => m.member_id === userId);
      const isCandidateOnSlot =
        isCandidate &&
        activeEnrolls.some((e: any) => e.candidate_id === userId);

      // Visibility:
      //   - admin: always
      //   - member: only if assigned to the slot
      //   - candidate: only if enrolled in the slot
      if (
        !payload.isAdmin &&
        !isMemberOnSlot &&
        !isCandidateOnSlot
      ) {
        continue;
      }

      const titleCandidates = activeEnrolls
        .map((e: any) =>
          e.candidate
            ? `${e.candidate.first_name || ""} ${e.candidate.last_name || ""}`.trim()
            : "",
        )
        .filter(Boolean)
        .join(", ");

      slotEvents.push({
        id: `slot:${slot.id}`,
        title: titleCandidates
          ? `${slot.epreuve.name} — ${titleCandidates}`
          : slot.epreuve.name,
        description: slot.label || null,
        day: slot.date,
        start_time: String(slot.start_time || "").substring(0, 5),
        end_time: String(slot.end_time || "").substring(0, 5),
        startTime: String(slot.start_time || "").substring(0, 5),
        endTime: String(slot.end_time || "").substring(0, 5),
        related_epreuve_id: slot.epreuve_id,
        related_member_id: null,
        related_candidate_id: null,
        is_global: false,
        visible_to_candidates: true,
        color: "#8B5CF6",
        room: slot.room || null,
        isSlot: true,
        slotStatus: slot.status,
        enrolledCount: activeEnrolls.length,
        maxCandidates: slot.max_candidates,
        epreuve: slot.epreuve,
      });
    }

    // FIX C4: explicit no-store
    return new Response(JSON.stringify([...filtered, ...slotEvents]), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Calendar GET error:", error);
    return Response.json({ error: "Failed to fetch events" }, { status: 500 });
  }
}

// POST /api/calendar — create a calendar event (admin only for global events)
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  try {
    const body = await req.json();
    const {
      title,
      description,
      day,
      day_end,
      start_time,
      end_time,
      startTime,
      endTime,
      related_epreuve_id,
      related_member_id,
      related_candidate_id,
      is_global,
      visible_to_candidates,
      color,
      type,
    } = body;

    // Only admins can create global events
    const isGlobal = is_global === true || type === "global";
    if (isGlobal && !payload.isAdmin) {
      return forbidden();
    }

    const insertData: Record<string, any> = {
      title,
      description: description || null,
      day: new Date(day).toISOString(),
      day_end: day_end ? new Date(day_end).toISOString() : null,
      start_time: start_time || startTime || "09:00",
      end_time: end_time || endTime || "10:00",
      related_epreuve_id: isGlobal ? null : related_epreuve_id || null,
      related_member_id: isGlobal ? null : related_member_id || null,
      related_candidate_id: isGlobal ? null : related_candidate_id || null,
      is_global: isGlobal,
      visible_to_candidates: visible_to_candidates !== false,
      color: color || "#3B82F6",
    };

    // max_candidates only for non-global events
    if (body.max_candidates) {
      insertData.max_candidates = body.max_candidates;
    }

    const { data, error } = await supabaseAdmin
      .from("calendar_events")
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;

    return Response.json(data, { status: 201 });
  } catch (error) {
    console.error("Create event error:", error);
    return Response.json(
      { error: "Failed to create event", details: String(error) },
      { status: 400 },
    );
  }
}
