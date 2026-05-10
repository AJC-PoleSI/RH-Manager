import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { NextRequest } from "next/server";

// DELETE /api/slots/enroll/[slotId] — cancel enrollment (with 24h rule)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slotId: string }> },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  if (payload.role !== "candidate") {
    return Response.json({ error: "Candidate auth required" }, { status: 401 });
  }

  const { slotId } = await params;
  const candidateId = payload.id;

  try {
    // Find enrollment
    const { data: enrollments, error: findError } = await supabaseAdmin
      .from("slot_enrollments")
      .select("id")
      .eq("slot_id", slotId)
      .eq("candidate_id", candidateId)
      .limit(1);

    if (findError) throw findError;

    if (!enrollments || enrollments.length === 0) {
      return Response.json(
        { error: "Inscription non trouvée" },
        { status: 404 },
      );
    }

    // ══════════════════════════════════════════════════════════════════
    // RÈGLE 24H : Vérifier que l'épreuve commence dans plus de 24h
    // ══════════════════════════════════════════════════════════════════
    const { data: slot, error: slotError } = await supabaseAdmin
      .from("evaluation_slots")
      .select("date, start_time")
      .eq("id", slotId)
      .single();

    if (slotError || !slot) {
      return Response.json({ error: "Créneau introuvable" }, { status: 404 });
    }

    // Build slot start datetime
    const slotDate = new Date(slot.date);
    const dateStr = `${slotDate.getFullYear()}-${String(slotDate.getMonth() + 1).padStart(2, "0")}-${String(slotDate.getDate()).padStart(2, "0")}`;
    const startTimeStr = slot.start_time || "00:00";
    const slotStartDateTime = new Date(`${dateStr}T${startTimeStr}:00`);

    const now = new Date();
    const hoursUntilStart =
      (slotStartDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntilStart < 24) {
      return Response.json(
        {
          error:
            "Annulation impossible : le créneau commence dans moins de 24 heures.",
        },
        { status: 403 },
      );
    }
    // ══════════════════════════════════════════════════════════════════

    // Delete enrollment
    const { error: deleteError } = await supabaseAdmin
      .from("slot_enrollments")
      .delete()
      .eq("id", enrollments[0].id);

    if (deleteError) throw deleteError;

    // If slot was full, reopen it
    const { data: updatedSlot } = await supabaseAdmin
      .from("evaluation_slots")
      .select(
        "*, enrollments:slot_enrollments(id), members:slot_member_assignments(id)",
      )
      .eq("id", slotId)
      .single();

    if (updatedSlot && updatedSlot.status === "full") {
      const newStatus =
        (updatedSlot.members?.length || 0) >= updatedSlot.min_members
          ? "ready"
          : "open";
      await supabaseAdmin
        .from("evaluation_slots")
        .update({ status: newStatus })
        .eq("id", slotId);
    }

    return Response.json({ success: true });
  } catch (error) {
    return Response.json(
      { error: "Failed to cancel enrollment" },
      { status: 500 },
    );
  }
}
