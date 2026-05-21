import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { NextRequest } from "next/server";

// PUT /api/calendar/[id] — update a calendar event
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const { id } = await params;

  try {
    const {
      title,
      description,
      day,
      day_end,
      start_time,
      end_time,
      startTime,
      endTime,
      visible_to_candidates,
      related_epreuve_id,
      related_member_id,
      related_candidate_id,
    } = await req.json();

    const data: Record<string, any> = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (day !== undefined) data.day = new Date(day).toISOString();
    if (day_end !== undefined) data.day_end = day_end ? new Date(day_end).toISOString() : null;
    if (start_time || startTime) data.start_time = start_time || startTime;
    if (end_time || endTime) data.end_time = end_time || endTime;
    if (visible_to_candidates !== undefined) data.visible_to_candidates = visible_to_candidates;
    if (related_epreuve_id !== undefined)
      data.related_epreuve_id = related_epreuve_id;
    if (related_member_id !== undefined)
      data.related_member_id = related_member_id;
    if (related_candidate_id !== undefined)
      data.related_candidate_id = related_candidate_id;

    const { data: event, error } = await supabaseAdmin
      .from("calendar_events")
      .update(data)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return Response.json(event);
  } catch (error) {
    console.error("Update event error:", error);
    return Response.json({ error: "Failed to update event" }, { status: 400 });
  }
}

// DELETE /api/calendar/[id] — delete a calendar event
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const { id } = await params;

  try {
    const { error } = await supabaseAdmin
      .from("calendar_events")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json({ error: "Failed to delete event" }, { status: 400 });
  }
}
