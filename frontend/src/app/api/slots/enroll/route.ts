import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import {
  filterActiveEnrollments,
  isActiveEnrollment,
  effectiveMaxCandidates,
} from "@/lib/enrollment";
import { getCandidateWishedPoles } from "@/lib/admission";
import { isTourLocked } from "@/lib/tour-status";
import { NextRequest } from "next/server";

// POST /api/slots/enroll — candidate enrolls in a slot
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const candidateId = payload.id;
  if (payload.role !== "candidate") {
    return Response.json({ error: "Candidate auth required" }, { status: 401 });
  }

  // Hoist slotId so it's accessible in the catch block (23505 handler).
  let slotId: string | undefined;

  try {
    const body = await req.json();
    ({ slotId } = body as { slotId: string; force?: boolean });
    const { force } = body as { slotId: string; force?: boolean };
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

    // PUBLICATION PAR ÉPREUVE : seuls les créneaux explicitement publiés
    // acceptent des inscriptions candidates.
    if (slot.status !== "published") {
      return Response.json(
        { error: "Ce créneau n'est plus disponible" },
        { status: 400 },
      );
    }

    // TOUR VERROUILLÉ : si le tour de l'épreuve est terminé, les inscriptions
    // sont closes (le candidat ne peut plus s'inscrire ni se réinscrire).
    const epreuveTour = slot.epreuve?.tour ?? slot.tour;
    if (epreuveTour != null && (await isTourLocked(Number(epreuveTour)))) {
      return Response.json(
        { error: "Ce tour est terminé : les inscriptions sont closes." },
        { status: 400 },
      );
    }

    // TOUR 3 : une épreuve de pôle n'est ouverte qu'aux candidats ayant
    // demandé ce pôle dans leurs vœux (défense en profondeur — le slot
    // est aussi masqué dans /slots/available).
    if (slot.epreuve?.is_pole_test && slot.epreuve?.pole) {
      const wishedPoles = await getCandidateWishedPoles(candidateId);
      if (!wishedPoles.includes(slot.epreuve.pole)) {
        return Response.json(
          {
            error: `Cette épreuve est réservée aux candidats ayant demandé le pôle ${slot.epreuve.pole}.`,
          },
          { status: 403 },
        );
      }
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

    // ══════════════════════════════════════════════════════════════════
    // CAPACITÉ EFFECTIVE : pour une épreuve de groupe, la vraie limite est
    // group_size. Certains anciens créneaux ont max_candidates=1 (créés
    // avant la persistance de group_size) → ils passaient "full" dès le
    // 1er inscrit. On dérive la capacité de l'épreuve et on auto-répare.
    // ══════════════════════════════════════════════════════════════════
    const effectiveMax = slot.epreuve?.is_group_epreuve
      ? Math.max(Number(slot.max_candidates) || 1, Number(slot.epreuve.group_size) || 1)
      : Number(slot.max_candidates) || 1;
    if (effectiveMax !== slot.max_candidates) {
      // Self-heal : aligne le créneau sur la capacité de l'épreuve.
      await supabaseAdmin
        .from("evaluation_slots")
        .update({ max_candidates: effectiveMax })
        .eq("id", slotId);
    }

    // FIX C2: only count ACTIVE enrollments for capacity (cancelled rows,
    // if any soft-cancel path ever exists, must not block new candidates).
    const activeEnrollments = (slot.enrollments || []).filter(filterActiveEnrollments);
    if (activeEnrollments.length >= effectiveMax) {
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
    if (myExisting && isActiveEnrollment(myExisting.status)) {
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

    // ══════════════════════════════════════════════════════════════════
    // Check if candidate already enrolled in another slot of same épreuve
    //
    // Previous version used `.select("...!inner(...)").eq("slot.epreuve_id", ...)`,
    // which can misbehave with PostgREST (the embedded filter doesn't
    // always translate to a SQL WHERE clause depending on version), AND
    // returned false positives for orphan rows (enrollment whose slot
    // was deleted). Result: candidate gets blocked with "vous êtes déjà
    // inscrit à un autre créneau" while they're not enrolled in any
    // visible slot.
    //
    // New approach:
    //   1. List ALL slot IDs of this épreuve in one query.
    //   2. Find candidate's NON-cancelled enrollments in those slots
    //      (excluding the current target slot — defensive).
    //   3. If any orphan enrollment row exists (slot was deleted but
    //      enrollment row remains), silently purge it instead of
    //      ghost-locking the candidate.
    //   4. Include slot date/time in error message so user knows what
    //      they need to cancel.
    // ══════════════════════════════════════════════════════════════════
    if (slot.epreuve_id) {
      const { data: epreuveSlots } = await supabaseAdmin
        .from("evaluation_slots")
        .select("id, date, start_time, end_time, room")
        .eq("epreuve_id", slot.epreuve_id);

      const validSlotIds = (epreuveSlots || []).map((s: any) => s.id);
      const otherSlotIds = validSlotIds.filter((id: string) => id !== slotId);
      const slotInfoById: Record<string, any> = {};
      (epreuveSlots || []).forEach((s: any) => {
        slotInfoById[s.id] = s;
      });

      // All candidate enrollments matching this épreuve (active, non-cancelled).
      const { data: candEnrolls } = await supabaseAdmin
        .from("slot_enrollments")
        .select("id, slot_id, status")
        .eq("candidate_id", candidateId);

      const conflicts: any[] = [];
      const orphansToPurge: string[] = [];

      for (const row of candEnrolls || []) {
        if (row.status === "cancelled") continue;
        if (row.slot_id === slotId) continue; // same slot → handled by myExisting above
        if (!row.slot_id) {
          orphansToPurge.push(row.id);
          continue;
        }
        // Orphan: enrollment points to a slot that no longer exists or
        // is not in this épreuve's slot list AND not in any other épreuve
        // we'd care about for THIS specific check.
        if (otherSlotIds.includes(row.slot_id)) {
          conflicts.push({
            enrollmentId: row.id,
            slot: slotInfoById[row.slot_id],
          });
        }
      }

      // Purge orphans best-effort so they don't keep ghost-locking.
      if (orphansToPurge.length > 0) {
        try {
          await supabaseAdmin
            .from("slot_enrollments")
            .delete()
            .in("id", orphansToPurge);
        } catch (e) {
          console.error("Orphan enrollment purge error:", e);
        }
      }

      if (conflicts.length > 0) {
        const c = conflicts[0];
        const s = c.slot || {};
        const dateLabel = s.date
          ? new Date(s.date).toLocaleDateString("fr-FR", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })
          : "date inconnue";
        const timeLabel = s.start_time
          ? `${String(s.start_time).substring(0, 5)}${s.end_time ? "-" + String(s.end_time).substring(0, 5) : ""}`
          : "";
        const roomLabel = s.room ? ` (salle ${s.room})` : "";

        // FIX: if the caller asked for `force: true`, auto-cancel
        // the conflicting enrollment(s) before proceeding. This is
        // the escape hatch when a candidate is stuck because the
        // conflicting slot isn't visible in their calendar (slot in
        // draft/closed status, race condition, stale data, etc.).
        if (force === true) {
          const conflictEnrollIds = conflicts
            .map((cc: any) => cc.enrollmentId)
            .filter(Boolean);
          if (conflictEnrollIds.length > 0) {
            try {
              await supabaseAdmin
                .from("slot_enrollments")
                .delete()
                .in("id", conflictEnrollIds);
            } catch (e) {
              console.error("Force-cancel of conflicting enrolls failed:", e);
              return Response.json(
                {
                  error:
                    "Impossible de désinscrire automatiquement votre ancien créneau. Réessayez.",
                },
                { status: 500 },
              );
            }
          }
          // fall through to the insert below
        } else {
          return Response.json(
            {
              error: `Vous êtes déjà inscrit à un autre créneau pour cette épreuve : ${dateLabel} ${timeLabel}${roomLabel}. Veuillez d'abord vous désinscrire de ce créneau.`,
              code: "ALREADY_ENROLLED_OTHER_SLOT",
              conflictingSlot: s,
              conflictingEnrollmentId: c.enrollmentId,
              conflictingSlotId: s.id,
            },
            { status: 400 },
          );
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // GARDE ABSOLUE : Anti-double évaluation [Candidat + Épreuve]
    // Si ce candidat a DÉJÀ été évalué pour cette épreuve, il ne peut
    // plus s'inscrire sur un créneau de la même épreuve.
    // ══════════════════════════════════════════════════════════════════
    if (slot.epreuve_id) {
      // FIX (audit #4): only block if the evaluation is FINALIZED
      // (scores actually present). A bare row with empty/null scores
      // would otherwise lock the candidate forever — a "ghost lock".
      const { data: existingEval } = await supabaseAdmin
        .from("candidate_evaluations")
        .select("id, scores, comment, members(first_name, last_name, email)")
        .eq("candidate_id", candidateId)
        .eq("epreuve_id", slot.epreuve_id)
        .limit(1);

      if (existingEval && existingEval.length > 0) {
        const row: any = existingEval[0];
        const rawScores = row.scores;
        let hasRealScores = false;
        try {
          const parsed =
            typeof rawScores === "string"
              ? JSON.parse(rawScores)
              : rawScores;
          if (parsed && typeof parsed === "object") {
            const values = Object.values(parsed);
            hasRealScores =
              values.length > 0 &&
              values.some(
                (v) =>
                  v !== null &&
                  v !== "" &&
                  v !== undefined &&
                  !(typeof v === "number" && isNaN(v)),
              );
          }
        } catch {
          // unparsable scores — treat as not finalized
          hasRealScores = false;
        }
        const hasComment = !!(row.comment && String(row.comment).trim());

        if (hasRealScores || hasComment) {
          const m = row.members;
          const evaluerName = m
            ? `${m.first_name || ""} ${m.last_name || ""}`.trim() || m.email
            : "Un membre";
          return Response.json(
            {
              error: `${evaluerName} a déjà évalué ce candidat pour cette épreuve. Inscription impossible.`,
              code: "ALREADY_EVALUATED",
            },
            { status: 400 },
          );
        }
        // Else: orphan row (empty scores AND empty comment) — purge it
        // so the candidate isn't ghost-locked. Best effort.
        try {
          await supabaseAdmin
            .from("candidate_evaluations")
            .delete()
            .eq("id", row.id);
        } catch (e) {
          console.error("Failed to purge orphan evaluation:", e);
        }
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
      // Extra guard: check directly in DB before inserting to prevent
      // any duplicate that slipped through the in-memory checks above
      // (e.g. when slot.enrollments cache was stale or status mismatch).
      const { data: existingInDb } = await supabaseAdmin
        .from("slot_enrollments")
        .select("id, status")
        .eq("slot_id", slotId)
        .eq("candidate_id", candidateId)
        .maybeSingle();

      if (existingInDb && isActiveEnrollment(existingInDb.status as any)) {
        return Response.json(
          { ...existingInDb, alreadyEnrolled: true },
          { status: 200 },
        );
      }

      // FIX: insert with explicit status="active". Without this, the
      // row's `status` column defaults to NULL (if no DB default), which
      // various read filters accept but which has caused inconsistent
      // states across endpoints. Be explicit.
      const { data, error } = await supabaseAdmin
        .from("slot_enrollments")
        .insert({
          slot_id: slotId,
          candidate_id: candidateId,
          status: "active",
          enrolled_at: new Date().toISOString(),
        })
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
      // Capacité effective (idem pré-check) — pas la valeur potentiellement
      // périmée stockée sur le créneau.
      const postMax = Math.max(
        Number(postCheck.max_candidates) || 1,
        effectiveMax,
      );
      const actives = (postCheck.enrollments || [])
        .filter(filterActiveEnrollments)
        .sort((a: any, b: any) =>
          String(a.enrolled_at || "").localeCompare(String(b.enrolled_at || "")),
        );

      if (actives.length > postMax) {
        // We are the loser of the race — rollback our insert.
        const loserIds = actives
          .slice(postMax)
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

      // On ne marque "full" QUE si la capacité effective est atteinte.
      const activeCount = actives.length;
      if (activeCount >= postMax) {
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
      // BUG FIX: `req.clone().json()` fails after body is consumed.
      // Use `slotId` from the outer scope — it's always in scope here.
      try {
        const { data: existing } = await supabaseAdmin
          .from("slot_enrollments")
          .select("*")
          .eq("slot_id", slotId)
          .eq("candidate_id", candidateId)
          .maybeSingle();
        if (existing) {
          return Response.json(
            { ...existing, alreadyEnrolled: true },
            { status: 200 },
          );
        }
      } catch {
        /* ignore */
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
