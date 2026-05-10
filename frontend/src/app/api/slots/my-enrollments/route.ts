import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { NextRequest } from "next/server";

// GET /api/slots/my-enrollments — candidate's enrollments
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const candidateId = payload.id;

  try {
    const { data: enrollments, error } = await supabaseAdmin
      .from("slot_enrollments")
      .select(
        `
        *,
        slot:evaluation_slots(
          *,
          epreuve:epreuves(name, tour, type, duration_minutes)
        )
      `,
      )
      .eq("candidate_id", candidateId);

    if (error) throw error;

    const safe = (enrollments || []).map((e: any) => ({
      id: e.id,
      slotId: e.slot_id,
      status: e.status,
      enrolledAt: e.enrolled_at,
      date: e.slot?.date,
      startTime: e.slot?.start_time,
      endTime: e.slot?.end_time,
      room: e.slot?.room,
      label: e.slot?.label,
      epreuve: e.slot?.epreuve
        ? {
            name: e.slot.epreuve.name,
            tour: e.slot.epreuve.tour,
            type: e.slot.epreuve.type,
            durationMinutes: e.slot.epreuve.duration_minutes,
          }
        : null,
    }));

    return Response.json(safe);
  } catch (error) {
    return Response.json(
      { error: "Failed to fetch enrollments" },
      { status: 500 },
    );
  }
}
