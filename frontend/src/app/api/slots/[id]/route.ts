import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";

// PUT /api/slots/[id] — update a slot (admin)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  const { id } = await params;

  try {
    const {
      label,
      maxCandidates,
      minMembers,
      simultaneousSlots,
      status,
      room,
      epreuveId,
      startTime,
      endTime,
      durationMinutes,
      tour,
    } = await req.json();

    const data: Record<string, any> = {};
    if (label !== undefined) data.label = label;
    if (maxCandidates !== undefined) data.max_candidates = maxCandidates;
    if (minMembers !== undefined) data.min_members = minMembers;
    if (simultaneousSlots !== undefined)
      data.simultaneous_slots = simultaneousSlots;
    if (status !== undefined) data.status = status;
    if (room !== undefined) data.room = room;
    if (epreuveId !== undefined) data.epreuve_id = epreuveId || null;
    if (startTime !== undefined) data.start_time = startTime;
    if (endTime !== undefined) data.end_time = endTime;
    if (durationMinutes !== undefined) data.duration_minutes = durationMinutes;
    if (tour !== undefined) data.tour = tour;

    const { data: slot, error } = await supabaseAdmin
      .from("evaluation_slots")
      .update(data)
      .eq("id", id)
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

    return Response.json(slot);
  } catch (error) {
    console.error("Update slot error:", error);
    return Response.json({ error: "Failed to update slot" }, { status: 500 });
  }
}

// DELETE /api/slots/[id] — delete a slot (admin)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  const { id } = await params;

  try {
    const { error } = await supabaseAdmin
      .from("evaluation_slots")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: "Failed to delete slot" }, { status: 500 });
  }
}
