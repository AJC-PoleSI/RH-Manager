import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { NextRequest } from "next/server";

// POST /api/slots/enroll — candidate enrolls in a slot
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const candidateId = payload.id;
  if (payload.role !== "candidate") {
    return Response.json({ error: "Candidate auth required" }, { status: 401 });
  }

  try {
    const { slotId } = await req.json();
    if (!slotId) {
      return Response.json({ error: "slotId required" }, { status: 400 });
    }

    // Fetch slot with enrollments and members
    const { data: slot, error: slotError } = await supabaseAdmin
      .from("evaluation_slots")
      .select(
        `
        *,
        enrollments:slot_enrollments(*),
        members:slot_member_assignments(id),
        epreuve:epreuves(*)
      `,
      )
      .eq("id", slotId)
      .single();

    if (slotError || !slot) {
      return Response.json({ error: "Slot not found" }, { status: 404 });
    }

    if (!["published", "ready"].includes(slot.status)) {
      return Response.json(
        { error: "Ce créneau n'est plus disponible" },
        { status: 400 },
      );
    }

    // Check per-epreuve inscription deadline
    if (slot.epreuve?.inscription_deadline) {
      const deadline = new Date(slot.epreuve.inscription_deadline);
      if (new Date() > deadline) {
        const formattedDeadline = deadline.toLocaleString("fr-FR", {
          timeZone: "Europe/Paris",
        });
        return Response.json(
          {
            error: `Les inscriptions pour cette épreuve sont fermées depuis le ${formattedDeadline}.`,
          },
          { status: 403 },
        );
      }
    }

    // Fallback: block enrollment if slot starts in less than 24h
    if (slot.date && slot.start_time) {
      const slotDate = slot.date.split("T")[0];
      const slotStart = new Date(`${slotDate}T${slot.start_time}`);
      const hoursUntil = (slotStart.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntil < 24) {
        return Response.json(
          {
            error:
              "Les inscriptions sont fermées pour ce créneau (moins de 24h avant l'épreuve).",
          },
          { status: 403 },
        );
      }
    }

    // Note: min_members check removed — status published/ready is the source of truth

    if ((slot.enrollments?.length || 0) >= slot.max_candidates) {
      return Response.json(
        { error: "Ce créneau est complet" },
        { status: 400 },
      );
    }

    // Check if already enrolled in this slot
    const alreadyEnrolled = slot.enrollments?.some(
      (e: any) => e.candidate_id === candidateId,
    );
    if (alreadyEnrolled) {
      return Response.json(
        { error: "Vous êtes déjà inscrit à ce créneau" },
        { status: 400 },
      );
    }

    // Check if candidate already enrolled in another slot for the same epreuve
    if (slot.epreuve_id) {
      const { data: otherEnrollment } = await supabaseAdmin
        .from("slot_enrollments")
        .select("id, slot:evaluation_slots!inner(epreuve_id)")
        .eq("candidate_id", candidateId)
        .eq("slot.epreuve_id", slot.epreuve_id)
        .neq("status", "cancelled")
        .limit(1);

      if (otherEnrollment && otherEnrollment.length > 0) {
        return Response.json(
          {
            error:
              "Vous êtes déjà inscrit à un autre créneau pour cette épreuve",
          },
          { status: 400 },
        );
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // GARDE ABSOLUE : Anti-double évaluation [Candidat + Épreuve]
    // Si ce candidat a DÉJÀ été évalué pour cette épreuve, il ne peut
    // plus s'inscrire sur un créneau de la même épreuve.
    // ══════════════════════════════════════════════════════════════════
    if (slot.epreuve_id) {
      const { data: existingEval } = await supabaseAdmin
        .from("candidate_evaluations")
        .select("id, members(first_name, last_name, email)")
        .eq("candidate_id", candidateId)
        .eq("epreuve_id", slot.epreuve_id)
        .limit(1);

      if (existingEval && existingEval.length > 0) {
        const m = (existingEval[0] as any).members;
        const evaluerName = m
          ? `${m.first_name || ""} ${m.last_name || ""}`.trim() || m.email
          : "Un membre";
        return Response.json(
          {
            error: `${evaluerName} a déjà évalué ce candidat pour cette épreuve. Inscription impossible.`,
          },
          { status: 400 },
        );
      }
    }

    // Create enrollment
    const { data: enrollment, error: enrollError } = await supabaseAdmin
      .from("slot_enrollments")
      .insert({ slot_id: slotId, candidate_id: candidateId })
      .select(
        `
        *,
        slot:evaluation_slots(*, epreuve:epreuves(name))
      `,
      )
      .single();

    if (enrollError) throw enrollError;

    // Auto-update status if full
    const { data: updatedSlot } = await supabaseAdmin
      .from("evaluation_slots")
      .select("*, enrollments:slot_enrollments(id)")
      .eq("id", slotId)
      .single();

    if (
      updatedSlot &&
      (updatedSlot.enrollments?.length || 0) >= updatedSlot.max_candidates
    ) {
      await supabaseAdmin
        .from("evaluation_slots")
        .update({ status: "full" })
        .eq("id", slotId);
    }

    return Response.json(enrollment, { status: 201 });
  } catch (error: any) {
    // Unique constraint violation
    if (error?.code === "23505") {
      return Response.json({ error: "Déjà inscrit" }, { status: 400 });
    }
    console.error("Enroll error:", error);
    return Response.json(
      { error: "Failed to enroll", details: String(error) },
      { status: 500 },
    );
  }
}
