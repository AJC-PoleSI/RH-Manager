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
          epreuve:epreuves(id, name, tour, type, duration_minutes)
        )
      `,
      )
      .eq("candidate_id", candidateId);

    if (error) throw error;

    // FIX M5: also expose slot.status and epreuve.id so the candidate UI
    // can tell when its slot got cancelled/downgraded and link properly.
    // FIX C2: hide cancelled enrollments from the candidate's own list.
    const safe = (enrollments || [])
      .filter((e: any) => !e.status || e.status === "active")
      .map((e: any) => ({
        id: e.id,
        slotId: e.slot_id,
        status: e.status,
        slotStatus: e.slot?.status,
        enrolledAt: e.enrolled_at,
        date: e.slot?.date,
        startTime: e.slot?.start_time,
        endTime: e.slot?.end_time,
        room: e.slot?.room,
        label: e.slot?.label,
        epreuve: e.slot?.epreuve
          ? {
              id: e.slot.epreuve.id,
              name: e.slot.epreuve.name,
              tour: e.slot.epreuve.tour,
              type: e.slot.epreuve.type,
              durationMinutes: e.slot.epreuve.duration_minutes,
            }
          : null,
      }));

    // FIX C4: no-store
    return new Response(JSON.stringify(safe), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    return Response.json(
      { error: "Failed to fetch enrollments" },
      { status: 500 },
    );
  }
}
