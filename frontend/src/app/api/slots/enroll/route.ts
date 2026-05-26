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

    // FIX C2: only count ACTIVE enrollments for capacity (cancelled rows,
    // if any soft-cancel path ever exists, must not block new candidates).
    const activeEnrollments = (slot.enrollments || []).filter(
      (e: any) => !e.status || e.status === "active",
    );
    if (activeEnrollments.length >= slot.max_candidates) {
      return Response.json(
        { error: "Ce créneau est complet" },
        { status: 400 },
      );
    }

    // FIX (idempotent): if the candidate has an ACTIVE row already, return
    // success (200) with the existing row instead of 400. This makes
    // /enroll safe to retry and self-heals frontend state desyncs.
    // If a CANCELLED row exists, we reactivate it below (instead of
    // inserting a new one, which would violate the unique constraint).
    const myExisting = (slot.enrollments || []).find(
      (e: any) => e.candidate_id === candidateId,
    );
    if (myExisting && (!myExisting.status || myExisting.status === "active")) {
      return Response.json(
        {
          id: myExisting.id,
          slot_id: slotId,
          candidate_id: candidateId,
          status: "active",
          alreadyEnrolled: true,
        },
        { status: 200 },
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

    // FIX (cancelled-row reuse): if a cancelled row exists for this
    // (slot, candidate), reactivate it instead of inserting a new one —
    // otherwise the unique constraint trips and the candidate is stuck.
    let enrollment: any = null;
    let enrollError: any = null;
    const cancelledRow = (slot.enrollments || []).find(
      (e: any) => e.candidate_id === candidateId && e.status === "cancelled",
    );

    if (cancelledRow) {
      const { data, error } = await supabaseAdmin
        .from("slot_enrollments")
        .update({ status: "active", enrolled_at: new Date().toISOString() })
        .eq("id", cancelledRow.id)
        .select(
          `
          *,
          slot:evaluation_slots(*, epreuve:epreuves(name))
        `,
        )
        .single();
      enrollment = data;
      enrollError = error;
    } else {
      const { data, error } = await supabaseAdmin
        .from("slot_enrollments")
        .insert({ slot_id: slotId, candidate_id: candidateId })
        .select(
          `
          *,
          slot:evaluation_slots(*, epreuve:epreuves(name))
        `,
        )
        .single();
      enrollment = data;
      enrollError = error;
    }

    if (enrollError) throw enrollError;

    // FIX H2: post-insert race-check. Two parallel POSTs could both pass
    // the pre-check above. Re-count active enrollments and rollback this
    // one if we exceeded capacity. Note: this is best-effort — a proper
    // fix requires a Postgres RPC/CHECK constraint, but this closes the
    // window in 99% of cases.
    const { data: postCheck } = await supabaseAdmin
      .from("evaluation_slots")
      .select(
        "max_candidates, enrollments:slot_enrollments(id, status, enrolled_at)",
      )
      .eq("id", slotId)
      .single();

    if (postCheck) {
      const actives = (postCheck.enrollments || [])
        .filter((e: any) => !e.status || e.status === "active")
        .sort((a: any, b: any) =>
          String(a.enrolled_at || "").localeCompare(String(b.enrolled_at || "")),
        );

      if (actives.length > postCheck.max_candidates) {
        // We are the loser of the race — rollback our insert.
        const loserIds = actives
          .slice(postCheck.max_candidates)
          .map((e: any) => e.id);
        if (loserIds.includes(enrollment.id)) {
          await supabaseAdmin
            .from("slot_enrollments")
            .delete()
            .eq("id", enrollment.id);
          return Response.json(
            { error: "Ce créneau est complet (course concurrente)" },
            { status: 409 },
          );
        }
      }

      // FIX C1 (paired): keep status mutation consistent — only mark
      // "full" when capacity exactly reached. Reads now tolerate "full"
      // for members (see my-slots), so this is purely informational.
      const activeCount = actives.length;
      if (activeCount >= postCheck.max_candidates) {
        await supabaseAdmin
          .from("evaluation_slots")
          .update({ status: "full" })
          .eq("id", slotId);
      }
    }

    return Response.json(enrollment, { status: 201 });
  } catch (error: any) {
    // FIX (idempotent): unique constraint hit means an enrollment already
    // exists. Try to recover it and return 200 so the frontend can
    // refresh its state cleanly instead of looping on "déjà inscrit".
    if (error?.code === "23505") {
      try {
        const { data: existing } = await supabaseAdmin
          .from("slot_enrollments")
          .select("*")
          .eq("slot_id", (await req.clone().json()).slotId)
          .eq("candidate_id", candidateId)
          .maybeSingle();
        if (existing) {
          return Response.json(
            { ...existing, alreadyEnrolled: true },
            { status: 200 },
          );
        }
      } catch {
        /* ignore — fall through to 400 */
      }
      return Response.json({ error: "Déjà inscrit" }, { status: 400 });
    }
    console.error("Enroll error:", error);
    return Response.json(
      { error: "Failed to enroll", details: String(error) },
      { status: 500 },
    );
  }
}
