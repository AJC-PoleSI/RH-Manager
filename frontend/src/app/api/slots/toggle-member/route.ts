import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { NextRequest } from "next/server";

// POST /api/slots/toggle-member — toggle member assignment on a slot
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  try {
    const body = await req.json();
    const { slotId, action } = body;
    // Admin peut spécifier un memberId arbitraire, sinon on prend l'utilisateur connecté
    const memberId =
      payload.isAdmin && body.memberId ? body.memberId : payload.id;
    if (!slotId) {
      return Response.json({ error: "slotId required" }, { status: 400 });
    }

    // Check if already assigned
    const { data: existing } = await supabaseAdmin
      .from("slot_member_assignments")
      .select("id")
      .eq("slot_id", slotId)
      .eq("member_id", memberId)
      .limit(1);

    // Si action explicite fournie par l'admin, respecter; sinon toggle
    const shouldRemove =
      action === "remove" || (!action && existing && existing.length > 0);
    const shouldAdd =
      action === "add" || (!action && (!existing || existing.length === 0));

    if (shouldRemove && existing && existing.length > 0) {
      // Remove assignment
      const { error: deleteError } = await supabaseAdmin
        .from("slot_member_assignments")
        .delete()
        .eq("id", existing[0].id);

      if (deleteError) throw deleteError;

      // Check if slot needs status downgrade
      const { data: slot } = await supabaseAdmin
        .from("evaluation_slots")
        .select("*, members:slot_member_assignments(id)")
        .eq("id", slotId)
        .single();

      if (
        slot &&
        slot.status === "ready" &&
        (slot.members?.length || 0) < slot.min_members
      ) {
        await supabaseAdmin
          .from("evaluation_slots")
          .update({ status: "open" })
          .eq("id", slotId);
      }

      return Response.json({ action: "removed" });
    } else if (shouldAdd) {
      // Add assignment
      const { error: insertError } = await supabaseAdmin
        .from("slot_member_assignments")
        .insert({ slot_id: slotId, member_id: memberId });

      if (insertError) {
        // Unique constraint violation
        if (insertError.code === "23505") {
          return Response.json({ error: "Already assigned" }, { status: 400 });
        }
        throw insertError;
      }

      // Check if slot reaches minMembers threshold
      const { data: slot } = await supabaseAdmin
        .from("evaluation_slots")
        .select("*, members:slot_member_assignments(id)")
        .eq("id", slotId)
        .single();

      if (
        slot &&
        slot.status === "open" &&
        (slot.members?.length || 0) >= slot.min_members
      ) {
        await supabaseAdmin
          .from("evaluation_slots")
          .update({ status: "ready" })
          .eq("id", slotId);
      }

      return Response.json({ action: "added" });
    } else {
      return Response.json({ action: "no_change" });
    }
  } catch (error) {
    console.error("Toggle member slot error:", error);
    return Response.json(
      { error: "Failed to toggle slot assignment" },
      { status: 500 },
    );
  }
}
