import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// POST /api/slots/reset — delete all slots for an epreuve (admin only)
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const { epreuveId, slotIds } = await req.json();

    if (!epreuveId && (!slotIds || slotIds.length === 0)) {
      return Response.json(
        { error: "epreuveId ou slotIds requis" },
        { status: 400 },
      );
    }

    // Determine which slot IDs to delete — always query the DB if epreuveId is provided
    let idsToDelete: string[] = [];

    if (epreuveId) {
      // Always query the DB to get ALL slots for this epreuve (not relying on frontend state)
      const { data: slots } = await supabaseAdmin
        .from("evaluation_slots")
        .select("id")
        .eq("epreuve_id", epreuveId);
      idsToDelete = (slots || []).map((s: any) => s.id);
    } else if (slotIds && slotIds.length > 0) {
      idsToDelete = slotIds;
    }

    if (idsToDelete.length === 0) {
      return Response.json({
        message: "Aucun créneau à supprimer",
        deleted: 0,
      });
    }

    // 1. Delete enrollments (inscriptions candidats)
    const { error: enrollError } = await supabaseAdmin
      .from("slot_enrollments")
      .delete()
      .in("slot_id", idsToDelete);
    if (enrollError) console.error("Delete enrollments error:", enrollError);

    // 2. Delete member assignments
    const { error: assignError } = await supabaseAdmin
      .from("slot_member_assignments")
      .delete()
      .in("slot_id", idsToDelete);
    if (assignError) console.error("Delete assignments error:", assignError);

    // 3. Delete availability requests if table exists
    try {
      await supabaseAdmin
        .from("slot_availability_requests")
        .delete()
        .in("slot_id", idsToDelete);
    } catch {
      // Table may not exist
    }

    // 4. Delete the slots themselves
    const { error: slotError } = await supabaseAdmin
      .from("evaluation_slots")
      .delete()
      .in("id", idsToDelete);

    if (slotError) throw slotError;

    return Response.json({
      message: `${idsToDelete.length} créneau(x) supprimé(s)`,
      deleted: idsToDelete.length,
    });
  } catch (error) {
    console.error("Reset slots error:", error);
    return Response.json(
      {
        error: "Echec de la réinitialisation des créneaux",
        details: String(error),
      },
      { status: 500 },
    );
  }
}
