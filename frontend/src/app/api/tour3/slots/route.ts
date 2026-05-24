import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  try {
    const { searchParams } = new URL(req.url);
    const pole = searchParams.get("pole");

    let query = supabaseAdmin
      .from("tour3_slots")
      .select(`
        *,
        examiner:members!tour3_slots_examiner_id_fkey(id, email),
        places:tour3_candidate_places(
          id, 
          candidate_id, 
          examiner_id,
          candidate:candidates!tour3_candidate_places_candidate_id_fkey(id, first_name, last_name),
          examiner:members!tour3_candidate_places_examiner_id_fkey(id, email)
        )
      `)
      .order("date_time", { ascending: true });

    if (pole) {
      query = query.eq("pole", pole);
    }

    const { data: slots, error } = await query;
    if (error) throw error;

    return Response.json(slots);
  } catch (error) {
    console.error("GET tour3/slots error:", error);
    return Response.json({ error: "Failed to fetch Tour 3 slots" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const body = await req.json();
    const { pole, dateTime, maxCapacity, examinerId } = body;

    if (!pole || !dateTime || !maxCapacity) {
      return Response.json({ error: "pole, dateTime, and maxCapacity are required" }, { status: 400 });
    }

    const insertData: any = {
      pole,
      date_time: dateTime,
      max_capacity: maxCapacity,
      created_by_admin: true,
      status: "open",
      enrolled_count: 0
    };

    if (examinerId) {
      insertData.examiner_id = examinerId;
    }

    const { data: slot, error } = await supabaseAdmin
      .from("tour3_slots")
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;

    return Response.json(slot, { status: 201 });
  } catch (error) {
    console.error("POST tour3/slots error:", error);
    return Response.json({ error: "Failed to create Tour 3 slot" }, { status: 500 });
  }
}
