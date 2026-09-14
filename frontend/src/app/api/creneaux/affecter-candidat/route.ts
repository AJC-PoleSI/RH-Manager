import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import {
  filterActiveEnrollments,
  effectiveMaxCandidates,
  isActiveEnrollment,
} from "@/lib/enrollment";
import {
  planCandidateMove,
  describeSlot,
  type MoveEnrollment,
  type MoveSlotRef,
} from "@/lib/candidate-move";
import { releaseSlotAfterUnenroll } from "@/lib/slot-release";
import { isFinalizedEvaluation } from "@/lib/evaluation-finalized";
import { isMissingColumnError, lockPatch } from "@/lib/slot-lock";
import { isFunctionMissingError } from "@/lib/dispatch-io";
import { sendDirectMessageEmail } from "@/lib/resend";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// POST /api/creneaux/affecter-candidat — l'admin pose un candidat sur un créneau
//
// Pendant candidat de /api/slots/toggle-member (examinateurs). Body :
//   { creneauId, candidateId, force?: boolean, notify?: boolean }
//
// CE QUI DISTINGUE CETTE ROUTE DE L'INSCRIPTION CANDIDATE
// ───────────────────────────────────────────────────────
// /api/slots/enroll applique les règles qui protègent le candidat de
// lui-même : préavis de 24h, date limite de l'épreuve, tour ouvert, créneau
// publié. Un admin qui rattrape une erreur de planning agit précisément
// parce que la situation est anormale — ces règles ne s'appliquent pas.
//
// Restent : la capacité de la salle, l'impossibilité d'être à deux endroits
// en même temps (toutes deux forçables, cf. lib/candidate-move.ts) et le
// refus absolu d'inscrire un candidat DÉJÀ ÉVALUÉ sur cette épreuve — celle-là
// n'est pas forçable : elle fausserait la délibération.
//
// Le chemin est en français (`creneaux`, pas `slots`) : un bloqueur de pub
// coupe silencieusement certaines URL contenant « /slots » côté navigateur.
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (payload.role === "candidate" || !payload.isAdmin) return forbidden();

  try {
    const body = await req.json();
    const creneauId: string | undefined = body?.creneauId;
    const candidateId: string | undefined = body?.candidateId;
    const force = body?.force === true;
    const notify = body?.notify !== false;

    if (!creneauId || !candidateId) {
      return Response.json(
        { error: "creneauId et candidateId sont requis" },
        { status: 400 },
      );
    }

    // ── Créneau d'arrivée ──
    const { data: target, error: targetErr } = await supabaseAdmin
      .from("evaluation_slots")
      .select(
        `
        id, date, start_time, end_time, room, epreuve_id, status,
        epreuve:epreuves(id, name, is_group_epreuve, group_size),
        enrollments:slot_enrollments(id, candidate_id, status),
        members:slot_member_assignments(id)
        `,
      )
      .eq("id", creneauId)
      .maybeSingle();

    if (targetErr) throw targetErr;
    if (!target) {
      return Response.json({ error: "Créneau introuvable" }, { status: 404 });
    }

    // ── Candidat ──
    const { data: candidate } = await supabaseAdmin
      .from("candidates")
      .select("id, first_name, last_name, email")
      .eq("id", candidateId)
      .maybeSingle();

    if (!candidate) {
      return Response.json({ error: "Candidat introuvable" }, { status: 404 });
    }

    const candidateName =
      `${candidate.first_name || ""} ${candidate.last_name || ""}`.trim() ||
      "Ce candidat";

    // ── Garde absolue : déjà évalué sur cette épreuve ──
    // Une ligne d'évaluation VIDE (formulaire ouvert puis abandonné) ne
    // verrouille rien : on la purge au passage plutôt que de bloquer.
    if (target.epreuve_id) {
      const { data: evals } = await supabaseAdmin
        .from("candidate_evaluations")
        .select("id, scores, comment")
        .eq("candidate_id", candidateId)
        .eq("epreuve_id", target.epreuve_id)
        .limit(1);

      const row = evals?.[0];
      if (row) {
        if (isFinalizedEvaluation(row)) {
          return Response.json(
            {
              error: `${candidateName} a déjà été évalué(e) sur cette épreuve : l'inscrire à nouveau fausserait la délibération.`,
              code: "ALREADY_EVALUATED",
            },
            { status: 409 },
          );
        }
        try {
          await supabaseAdmin
            .from("candidate_evaluations")
            .delete()
            .eq("id", row.id);
        } catch (e) {
          console.error("Purge évaluation orpheline échouée:", e);
        }
      }
    }

    // ── Emploi du temps actuel du candidat ──
    const { data: rawEnrollments } = await supabaseAdmin
      .from("slot_enrollments")
      .select(
        `
        id, status, slot_id,
        slot:evaluation_slots(
          id, date, start_time, end_time, room, epreuve_id,
          epreuve:epreuves(name)
        )
        `,
      )
      .eq("candidate_id", candidateId);

    // Lignes orphelines (créneau supprimé) : elles ne représentent aucun
    // rendez-vous mais bloqueraient la contrainte d'unicité plus tard. On
    // les purge au passage (best-effort), comme le fait /api/slots/enroll.
    const orphans = (rawEnrollments || []).filter((e: any) => !e.slot);
    if (orphans.length > 0) {
      try {
        await supabaseAdmin
          .from("slot_enrollments")
          .delete()
          .in(
            "id",
            orphans.map((e: any) => e.id),
          );
      } catch (e) {
        console.error("Purge inscriptions orphelines échouée:", e);
      }
    }

    const enrollments: MoveEnrollment[] = (rawEnrollments || [])
      .filter((e: any) => e.slot)
      .map((e: any) => ({
        id: e.id,
        status: e.status,
        slot: {
          id: e.slot.id,
          date: e.slot.date,
          start_time: e.slot.start_time,
          end_time: e.slot.end_time,
          room: e.slot.room,
          epreuve_id: e.slot.epreuve_id,
          epreuve_name: e.slot.epreuve?.name ?? null,
        },
      }));

    const targetRef: MoveSlotRef = {
      id: target.id,
      date: target.date,
      start_time: target.start_time,
      end_time: target.end_time,
      room: target.room,
      epreuve_id: target.epreuve_id,
      epreuve_name: (target as any).epreuve?.name ?? null,
    };

    const capacity = effectiveMaxCandidates(target as any);
    const occupied = ((target as any).enrollments || []).filter(
      filterActiveEnrollments,
    ).length;

    const plan = planCandidateMove({
      target: targetRef,
      enrollments,
      capacity,
      occupied,
      force,
    });

    if (!plan.ok) {
      return Response.json(
        { error: plan.message, code: plan.code, conflict: plan.conflict ?? null },
        { status: 409 },
      );
    }

    if (plan.alreadyHere) {
      return Response.json({
        success: true,
        alreadyEnrolled: true,
        moved: false,
        message: `${candidateName} est déjà inscrit(e) sur ce créneau.`,
      });
    }

    // ══════════════════════════════════════════════════════════════════
    // ÉCRITURE — on INSCRIT d'abord, on libère ensuite
    // ══════════════════════════════════════════════════════════════════
    // L'ordre n'est pas neutre : si la libération passait en premier et que
    // l'inscription échouait, le candidat se retrouverait sans aucun créneau
    // pour cette épreuve — un rendez-vous détruit pour rien. Dans l'autre
    // sens, le pire cas est une inscription en double, visible et réparable.
    const enrolled = await enrollOnSlot(creneauId, candidateId, force ? null : capacity);
    if (!enrolled.ok) {
      return Response.json(
        { error: enrolled.error, code: enrolled.code },
        { status: enrolled.code === "SLOT_FULL" ? 409 : 500 },
      );
    }

    const releasedSlots: MoveSlotRef[] = [];
    if (plan.release.length > 0) {
      const ids = plan.release.map((e) => e.id);
      const { error: delErr } = await supabaseAdmin
        .from("slot_enrollments")
        .delete()
        .in("id", ids);
      if (delErr) {
        console.error("Libération de l'ancien créneau échouée:", delErr);
      } else {
        for (const e of plan.release) if (e.slot) releasedSlots.push(e.slot);
      }
    }

    // Remise en état des créneaux quittés (réouverture + verrou).
    for (const s of releasedSlots) {
      await releaseSlotAfterUnenroll(s.id);
    }

    // ── VERROU sur le créneau d'arrivée ──
    // Un rendez-vous vient d'être posé : ce créneau ne se rebrasse plus.
    try {
      const { error: lockErr } = await supabaseAdmin
        .from("evaluation_slots")
        .update(lockPatch("inscription"))
        .eq("id", creneauId)
        .eq("is_locked", false);
      if (lockErr && !isMissingColumnError(lockErr)) {
        console.error("Verrouillage du créneau d'arrivée échoué:", lockErr);
      }
    } catch (e) {
      console.error("Verrouillage du créneau d'arrivée échoué:", e);
    }

    // Capacité atteinte après un ajout forcé : le RPC ne l'a pas vu passer
    // (on lui avait retiré son plafond), il faut marquer "full" à la main —
    // sinon un candidat pourrait encore réserver une place qui n'existe pas.
    if (force && capacity >= 1) {
      const { count } = await supabaseAdmin
        .from("slot_enrollments")
        .select("id", { count: "exact", head: true })
        .eq("slot_id", creneauId)
        .or("status.is.null,status.eq.active,status.eq.enrolled");
      if ((count ?? 0) >= capacity && target.status !== "full") {
        await supabaseAdmin
          .from("evaluation_slots")
          .update({ status: "full" })
          .eq("id", creneauId);
      }
    }

    // ── PRÉVENIR LE CANDIDAT ──
    // Son rendez-vous vient de changer sans qu'il ait rien demandé : le
    // laisser le découvrir sur son calendrier, c'est un candidat qui se
    // présente au mauvais endroit. `notify: false` reste possible pour les
    // corrections de coquille sur un planning que personne n'a encore vu.
    let notified = false;
    if (notify) {
      const epName = targetRef.epreuve_name || "Épreuve";
      const message = plan.from
        ? `📅 Changement de créneau : votre épreuve « ${epName} » a lieu désormais le ${describeSlot(targetRef)}, et non plus le ${describeSlot(plan.from)}. Vérifiez votre calendrier.`
        : `📅 Vous êtes inscrit(e) à l'épreuve « ${epName} » le ${describeSlot(targetRef)}. Vérifiez votre calendrier.`;

      try {
        const { error: msgErr } = await supabaseAdmin
          .from("private_messages")
          .insert({
            sender_id: null,
            sender_role: "admin",
            sender_name: "Système",
            recipient_id: candidateId,
            recipient_role: "candidate",
            message,
          });
        if (msgErr) throw msgErr;
        notified = true;
      } catch (e) {
        console.error("Message candidat (changement de créneau) échec:", e);
      }

      if (candidate.email) {
        // Best-effort : l'email ne doit pas faire échouer le déplacement.
        await sendDirectMessageEmail({
          to: candidate.email,
          firstName: candidate.first_name,
          senderName: "Équipe recrutement AJC",
          message,
          recipientRole: "candidate",
        });
      }
    }

    return Response.json({
      success: true,
      moved: !!plan.from,
      released: releasedSlots.map((s) => ({ id: s.id, label: describeSlot(s) })),
      notified,
      message: plan.from
        ? `${candidateName} a été déplacé(e) depuis ${describeSlot(plan.from)}.`
        : `${candidateName} a été inscrit(e) sur ce créneau.`,
    });
  } catch (error) {
    console.error("Affectation candidat:", error);
    return Response.json(
      { error: "Affectation impossible" },
      { status: 500 },
    );
  }
}

type EnrollResult =
  | { ok: true }
  | { ok: false; code: "SLOT_FULL" | "ERROR"; error: string };

/**
 * Inscrit le candidat sur le créneau, en réactivant une ligne annulée le cas
 * échéant (la contrainte unique (slot_id, candidate_id) interdit d'en insérer
 * une seconde).
 *
 * `maxCandidates = null` → l'admin force : on retire le plafond au RPC plutôt
 * que de contourner le verrou pessimiste, qui reste notre seule protection
 * contre la survente concurrente (cf. supabase-migration-enroll-atomic.sql).
 */
async function enrollOnSlot(
  slotId: string,
  candidateId: string,
  maxCandidates: number | null,
): Promise<EnrollResult> {
  const cap = maxCandidates ?? 100000;

  const { data: rpc, error: rpcError } = await supabaseAdmin.rpc(
    "enroll_candidate_atomic",
    {
      p_slot_id: slotId,
      p_candidate_id: candidateId,
      p_max_candidates: cap,
    },
  );

  if (!rpcError) {
    if (rpc?.status === "full") {
      return {
        ok: false,
        code: "SLOT_FULL",
        error: "Ce créneau vient d'être complété par une autre inscription.",
      };
    }
    return { ok: true };
  }

  if (!isFunctionMissingError(rpcError)) {
    console.error("enroll_candidate_atomic:", rpcError);
    return { ok: false, code: "ERROR", error: "Inscription impossible" };
  }

  // ── Repli NON ATOMIQUE (migration pas encore appliquée) ──
  console.warn(
    "[affecter-candidat] RPC enroll_candidate_atomic absente — repli non atomique. Appliquez supabase-migration-enroll-atomic.sql.",
  );

  const { data: existing } = await supabaseAdmin
    .from("slot_enrollments")
    .select("id, status")
    .eq("slot_id", slotId)
    .eq("candidate_id", candidateId)
    .maybeSingle();

  if (existing) {
    if (isActiveEnrollment(existing.status as any)) return { ok: true };
    const { error } = await supabaseAdmin
      .from("slot_enrollments")
      .update({ status: "active", enrolled_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) {
      console.error("Réactivation inscription échouée:", error);
      return { ok: false, code: "ERROR", error: "Inscription impossible" };
    }
    return { ok: true };
  }

  const { error } = await supabaseAdmin.from("slot_enrollments").insert({
    slot_id: slotId,
    candidate_id: candidateId,
    status: "active",
    enrolled_at: new Date().toISOString(),
  });

  // 23505 = la ligne existe déjà (course) : l'inscription est acquise.
  if (error && (error as any).code !== "23505") {
    console.error("Insertion inscription échouée:", error);
    return { ok: false, code: "ERROR", error: "Inscription impossible" };
  }
  return { ok: true };
}
