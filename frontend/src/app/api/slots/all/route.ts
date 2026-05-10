import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";

// GET /api/slots/all — get all slots with members & enrollments (with optional filters)
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const { searchParams } = new URL(req.url);
  const tour = searchParams.get("tour");
  const status = searchParams.get("status");
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  try {
    let query = supabaseAdmin
      .from("evaluation_slots")
      .select(
        `
        *,
        epreuve:epreuves(id, name, tour, type, is_group_epreuve),
        members:slot_member_assignments(*, member:members(id, email)),
        enrollments:slot_enrollments(*, candidate:candidates(id, first_name, last_name, email)),
        requests:slot_availability_requests(*, member:members(id, email))
      `,
      )
      .order("date", { ascending: true })
      .order("start_time", { ascending: true });

    if (tour) query = query.eq("tour", parseInt(tour));
    if (status) query = query.eq("status", status);
    if (start && end) {
      const startDate = new Date(start);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(end);
      endDate.setHours(23, 59, 59, 999);
      query = query
        .gte("date", startDate.toISOString())
        .lte("date", endDate.toISOString());
    }

    const { data, error } = await query;
    if (error) throw error;
    const validData = (data || []).filter((slot: any) => slot.epreuve);
    return Response.json(validData);
  } catch (error) {
    return Response.json({ error: "Failed to fetch slots" }, { status: 500 });
  }
}
