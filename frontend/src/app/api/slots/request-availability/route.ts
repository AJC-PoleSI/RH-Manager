import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { NextRequest } from "next/server";

// POST /api/slots/request-availability — toggle availability request on a slot
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const memberId = payload.id;

  try {
    const { slotId } = await req.json();
    if (!slotId) {
      return Response.json({ error: "slotId required" }, { status: 400 });
    }

    // Check if already requested
    const { data: existing } = await supabaseAdmin
      .from("slot_availability_requests")
      .select("id")
      .eq("slot_id", slotId)
      .eq("member_id", memberId)
      .limit(1);

    if (existing && existing.length > 0) {
      // Remove request
      const { error: deleteError } = await supabaseAdmin
        .from("slot_availability_requests")
        .delete()
        .eq("id", existing[0].id);

      if (deleteError) throw deleteError;

      return Response.json({ action: "removed" });
    } else {
      // Add request
      const { error: insertError } = await supabaseAdmin
        .from("slot_availability_requests")
        .insert({ slot_id: slotId, member_id: memberId });

      if (insertError) {
        if (insertError.code === "23505") {
          return Response.json({ error: "Already requested" }, { status: 400 });
        }
        throw insertError;
      }

      return Response.json({ action: "added" });
    }
  } catch (error) {
    console.error("Request availability error:", error);
    return Response.json(
      { error: "Failed to toggle request" },
      { status: 500 },
    );
  }
}
