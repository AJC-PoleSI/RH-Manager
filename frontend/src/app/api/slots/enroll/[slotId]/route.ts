import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { releaseSlotAfterUnenroll } from "@/lib/slot-release";
import { NextRequest } from "next/server";
import { canCancelEnrollment, noticeHoursForTour } from "@/lib/enrollment-window";
import { notifyMembers } from "@/lib/notifications";

// DELETE /api/slots/enroll/[slotId]
//   Candidate: cancels their own enrollment (24h notice, 2h in Tour 3)
//   Admin:     can unenroll any candidate — pass ?candidateId=<uuid>
//              to specify who, no notice restriction.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slotId: string }> },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const isAdmin = !!payload.isAdmin;

  // Non-admin, non-candidate → refuse
  if (!isAdmin && payload.role !== "candidate") {
    return Response.json({ error: "Accès interdit" }, { status: 403 });
  }

  const { slotId } = await params;
  const { searchParams } = new URL(req.url);

  // Admin can specify which candidate to unenroll
  const candidateId = isAdmin && searchParams.get("candidateId")
    ? searchParams.get("candidateId")!
    : payload.id;

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
    // PRÉAVIS : 24 h, ou 2 h au Tour 3 (cf. plus bas)
    // ══════════════════════════════════════════════════════════════════
    const { data: slot, error: slotError } = await supabaseAdmin
      .from("evaluation_slots")
      .select("date, start_time, room, tour, epreuve:epreuves(tour, name), members:slot_member_assignments(member_id)")
      .eq("id", slotId)
      .single();

    if (slotError || !slot) {
      // The slot doesn't exist anymore. Just delete the enrollment to clean up orphaned data!
      const { error: cleanupError } = await supabaseAdmin
        .from("slot_enrollments")
        .delete()
        .eq("id", enrollments[0].id);
      
      if (cleanupError) throw cleanupError;
      return Response.json({ success: true, message: "Inscription obsolète supprimée" });
    }

    // Préavis : 24 h, ou 2 h au Tour 3 (décision de Felix, 07/10/2026),
    // calculé en heure de Paris (cf. lib/enrollment-window.ts).
    const slotTour = (slot as any).epreuve?.tour ?? (slot as any).tour;
    const noticeHours = noticeHoursForTour(slotTour);

    // Admin bypass : pas de préavis pour les désinscriptions forcées
    if (
      !isAdmin &&
      !canCancelEnrollment({ date: slot.date, startTime: slot.start_time, noticeHours })
    ) {
      return Response.json(
        {
          error: `Annulation impossible : le créneau commence dans moins de ${noticeHours} heures.`,
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

    // Rouvrir le créneau s'il était complet et lever le verrou « inscription »
    // s'il ne reste plus personne (règle partagée avec le déplacement de
    // candidat par l'admin — cf. lib/slot-release.ts).
    await releaseSlotAfterUnenroll(slotId);

    // Prévenir le jury qu'une place s'est libérée (notification in-app, jamais
    // de mail). Best-effort : la désinscription est déjà faite.
    if (!isAdmin) {
      try {
        const { data: cand } = await supabaseAdmin
          .from("candidates")
          .select("first_name, last_name")
          .eq("id", candidateId)
          .maybeSingle();
        const who = cand ? `${cand.first_name || ""} ${cand.last_name || ""}`.trim() : "Un candidat";
        const dayLabel = new Date(slot.date).toLocaleDateString("fr-FR", {
          weekday: "long",
          day: "numeric",
          month: "long",
          timeZone: "Europe/Paris",
        });
        await notifyMembers(
          ((slot as any).members || []).map((m: any) => m.member_id),
          {
            type: "slot_unenrollment",
            title: "Candidat désinscrit",
            body: `${who} s'est désinscrit(e) de « ${(slot as any).epreuve?.name || "l'épreuve"} » le ${dayLabel} à ${String(slot.start_time || "").slice(0, 5)}${(slot as any).room ? ` (${(slot as any).room})` : ""}.`,
            link: "/dashboard",
          },
        );
      } catch (e) {
        console.error("Notification du jury à la désinscription échouée:", e);
      }
    }

    return Response.json({ success: true });
  } catch (error) {
    return Response.json(
      { error: "Failed to cancel enrollment" },
      { status: 500 },
    );
  }
}
