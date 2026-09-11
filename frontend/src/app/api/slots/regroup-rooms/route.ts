import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { filterActiveEnrollments, effectiveMaxCandidates } from "@/lib/enrollment";
import { slotGroupKey, regroupEnrollments } from "@/lib/room-packing";
import { sendRoomChangeEmail } from "@/lib/resend";
import { NextRequest } from "next/server";

/**
 * POST /api/slots/regroup-rooms — regroupe les inscriptions candidats (admin).
 *
 * Quand plusieurs salles portent la même épreuve au même horaire, les
 * inscriptions passées se sont éparpillées : un candidat par salle, donc un
 * jury complet mobilisé par salle, et des examinateurs qui se déplacent pour
 * suivre les candidats. On rassemble ces inscriptions sur le moins de salles
 * possible — l'HORAIRE ne change jamais, seule la salle change.
 *
 * Les nouvelles inscriptions n'ont plus ce problème : la salle y est choisie
 * par le système (cf. /api/slots/enroll et room-packing.ts). Cette route sert
 * au rattrapage de l'existant, et après une vague d'annulations.
 *
 * Body : { dryRun?: boolean, notify?: boolean }
 *   dryRun (défaut true) — calcule le plan sans rien modifier.
 *   notify (défaut false) — envoie un email aux candidats déplacés.
 */
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dryRun !== false;
    const notify = body?.notify === true;

    const { data: rawSlots, error } = await supabaseAdmin
      .from("evaluation_slots")
      .select(
        `
        id, date, start_time, end_time, room, status, min_members, max_candidates, epreuve_id,
        enrollments:slot_enrollments(id, candidate_id, status),
        members:slot_member_assignments(id),
        epreuve:epreuves(name, is_group_epreuve, group_size)
      `,
      );
    if (error) throw error;

    const today = new Date().toISOString().substring(0, 10);
    const slots = (rawSlots || [])
      .filter((s: any) => String(s.date || "").substring(0, 10) >= today)
      .filter((s: any) => s.status !== "closed")
      .map((s: any) => ({
        ...s,
        enrollments: (s.enrollments || []).filter(filterActiveEnrollments),
      }));

    // Regroupement horaire par horaire.
    const groups = new Map<string, any[]>();
    for (const slot of slots) {
      const key = slotGroupKey(slot);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(slot);
    }

    const slotById = new Map(slots.map((s: any) => [s.id, s]));
    const plan: Array<{
      candidateId: string;
      fromSlotId: string;
      toSlotId: string;
      fromRoom: string | null;
      toRoom: string | null;
      epreuve: string;
      date: string;
      time: string;
    }> = [];

    for (const group of Array.from(groups.values())) {
      if (group.length < 2) continue;
      if (!group.some((s: any) => s.enrollments.length > 0)) continue;

      const moves = regroupEnrollments(
        group.map((s: any) => ({
          slotId: s.id,
          room: s.room || null,
          enrolledCount: s.enrollments.length,
          capacity: effectiveMaxCandidates(s),
          juryInPlace: (s.members?.length || 0) > 0,
        })),
        new Map(
          group.map((s: any) => [
            s.id,
            s.enrollments.map((e: any) => e.candidate_id),
          ]),
        ),
      );

      for (const move of moves) {
        const from: any = slotById.get(move.fromSlotId);
        const to: any = slotById.get(move.toSlotId);
        plan.push({
          ...move,
          fromRoom: from?.room || null,
          toRoom: to?.room || null,
          epreuve: to?.epreuve?.name || "Épreuve",
          date: String(to?.date || "").substring(0, 10),
          time: `${String(to?.start_time || "").substring(0, 5)} – ${String(to?.end_time || "").substring(0, 5)}`,
        });
      }
    }

    if (dryRun) {
      return Response.json({ dryRun: true, moves: plan.length, plan });
    }

    // ── Application ──
    let applied = 0;
    const failures: Array<{ candidateId: string; reason: string }> = [];
    for (const move of plan) {
      const { error: updErr } = await supabaseAdmin
        .from("slot_enrollments")
        .update({ slot_id: move.toSlotId })
        .eq("slot_id", move.fromSlotId)
        .eq("candidate_id", move.candidateId);
      if (updErr) {
        failures.push({
          candidateId: move.candidateId,
          reason: String((updErr as any)?.message || updErr),
        });
        continue;
      }
      applied++;
    }

    // ── Notification des candidats déplacés ──
    let emailsSent = 0;
    if (notify && applied > 0) {
      const movedIds = Array.from(new Set(plan.map((m) => m.candidateId)));
      const { data: candidates } = await supabaseAdmin
        .from("candidates")
        .select("id, first_name, email")
        .in("id", movedIds);
      const byId = new Map((candidates || []).map((c: any) => [c.id, c]));

      const results = await Promise.allSettled(
        plan.map((move) => {
          const candidate: any = byId.get(move.candidateId);
          if (!candidate?.email) {
            return Promise.reject(new Error("email manquant"));
          }
          const dateLabel = new Date(`${move.date}T12:00:00`).toLocaleDateString(
            "fr-FR",
            { weekday: "long", day: "numeric", month: "long" },
          );
          return sendRoomChangeEmail({
            to: candidate.email,
            firstName: candidate.first_name ?? null,
            epreuve: move.epreuve,
            dateLabel,
            timeLabel: move.time,
            oldRoom: move.fromRoom,
            newRoom: move.toRoom,
          });
        }),
      );
      emailsSent = results.filter((r) => r.status === "fulfilled").length;
    }

    return Response.json({
      dryRun: false,
      moves: plan.length,
      applied,
      emailsSent,
      failures,
      plan,
    });
  } catch (e) {
    console.error("Regroup rooms error:", e);
    return Response.json(
      { error: "Échec du regroupement des salles" },
      { status: 500 },
    );
  }
}
