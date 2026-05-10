import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
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
    const filtered = (data || []).filter((event: any) => {
      // Événement global → visible par tous
      if (event.is_global) return true;
      if (!event.related_member_id && !event.related_candidate_id) return true;
      // Événement assigné à cet utilisateur
      if (payload.role === "member" && event.related_member_id === userId)
        return true;
      if (payload.role === "candidate" && event.related_candidate_id === userId)
        return true;
      // Admin voit tout
      if (payload.isAdmin) return true;
      return false;
    });

    return Response.json(filtered);
  } catch (error) {
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
      start_time,
      end_time,
      startTime,
      endTime,
      related_epreuve_id,
      related_member_id,
      related_candidate_id,
      is_global,
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
      start_time: start_time || startTime || "09:00",
      end_time: end_time || endTime || "10:00",
      related_epreuve_id: related_epreuve_id || null,
      related_member_id: isGlobal ? null : related_member_id || null,
      related_candidate_id: isGlobal ? null : related_candidate_id || null,
      is_global: isGlobal,
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
