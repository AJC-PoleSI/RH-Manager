import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  try {
    const { slotId } = await req.json();

    if (!slotId) {
      return Response.json({ error: "slotId is required" }, { status: 400 });
    }

    // Call the Postgres RPC function
    const { error } = await supabaseAdmin.rpc("liberate_places_for_examiner", {
      p_examiner_id: payload.userId,
      p_slot_id: slotId
    });

    if (error) throw error;

    return Response.json({ success: true });
  } catch (error) {
    console.error("POST tour3/liberate error:", error);
    return Response.json({ error: "Failed to liberate places" }, { status: 500 });
  }
}
