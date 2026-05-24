import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  // Optionally ensure the caller is a candidate
  // We'll just rely on the candidateId passed, or we can enforce payload.userId is a candidate

  try {
    const { placeId, candidateId } = await req.json();

    if (!placeId || !candidateId) {
      return Response.json({ error: "placeId and candidateId are required" }, { status: 400 });
    }

    // Call the Postgres RPC function
    const { error } = await supabaseAdmin.rpc("enroll_candidate_to_slot", {
      p_candidate_id: candidateId,
      p_place_id: placeId
    });

    if (error) throw error;

    return Response.json({ success: true });
  } catch (error) {
    console.error("POST tour3/enroll error:", error);
    return Response.json({ error: "Failed to enroll candidate" }, { status: 500 });
  }
}
