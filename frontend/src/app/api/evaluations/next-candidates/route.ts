import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { isActiveEnrollment } from "@/lib/enrollment";
import {
  buildClosureIndex,
  evaluationClosure,
  hasAnyEvaluation,
  parisClock,
  slotHasEnded,
  type ClosureReason,
} from "@/lib/evaluation-closure";
import { fetchSlotLinks } from "@/lib/slot-links-db";
import { fetchAllRows } from "@/lib/supabase-paging";
import { NextRequest } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
export const dynamic = "force-dynamic";

// GET /api/evaluations/next-candidates
//
// Ce qu'il reste à évaluer pour le membre connecté, et ce qui est déjà clos.
//
// Réponse : { candidates, done, alerts }
//   • candidates — encore à noter (le bouton « Évaluer » est actif) ;
//   • done       — candidats de mes créneaux déjà notés, en lecture seule :
//                  ils disparaissent de la file d'attente mais restent
//                  visibles, sinon un examinateur qui a tout fait ne voit
//                  plus rien et croit à un bug ;
//   • alerts     — business games TERMINÉS où des candidats n'ont reçu
//                  aucune note (cf. lib/evaluation-closure).
//
// La règle de clôture vit dans lib/evaluation-closure et est la même que
// celle appliquée à l'écriture (POST /api/evaluations) et dans le formulaire
// (/api/evaluations/allowed-epreuves).

interface SlotInfo {
  slotId: string;
  epreuveId: string;
  isGroupEpreuve: boolean;
  date: string | null;
  endTime: string | null;
  room: string | null;
  startTime: string | null;
  epreuveName: string;
  epreuveTour: number | null;
  candidateIds: string[];
}

/** Nom affichable d'un membre, repli sur son email. */
function memberName(m: { first_name?: string | null; last_name?: string | null; email?: string | null } | null | undefined): string {
  if (!m) return "un autre examinateur";
  const full = `${m.first_name || ""} ${m.last_name || ""}`.trim();
  return full || m.email || "un autre examinateur";
}

/** Date/heure de début du créneau, pour trier la file d'attente. */
function slotStartDate(date: string | null, startTime: string | null): Date {
  const day = String(date || "").split("T")[0];
  if (!day) return new Date(0);
  return new Date(`${day}T${(startTime || "00:00").slice(0, 5)}:00`);
}

export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const memberId = payload.id;

  try {
    // 1. Créneaux où je suis assigné, avec leurs candidats inscrits.
    const { data: assignments, error: assignError } = await supabaseAdmin
      .from("slot_member_assignments")
      .select(`
        slot:evaluation_slots(
          id,
          date,
          start_time,
          end_time,
          room,
          status,
          epreuve:epreuves(id, name, tour, type, is_group_epreuve),
          enrollments:slot_enrollments(
            status,
            candidate:candidates(id, first_name, last_name)
          )
        )
      `)
      .eq("member_id", memberId);

    if (assignError) throw assignError;

    // 2. Un candidat par épreuve (un candidat inscrit sur deux créneaux de la
    //    même épreuve ne se note qu'une fois).
    const candidatesMap = new Map<string, any>();
    const slots: SlotInfo[] = [];
    const groupEpreuveIds = new Set<string>();

    for (const a of assignments || []) {
      const slot = (a as any).slot;
      if (!slot || !slot.epreuve) continue;
      // Tous les statuts où un candidat peut être inscrit (même liste que
      // /api/slots/my-slots, pour que calendrier et évaluations concordent).
      if (
        !["draft", "open", "ready", "published", "full", "closed"].includes(
          slot.status,
        )
      ) {
        continue;
      }

      const isGroupEpreuve = slot.epreuve.is_group_epreuve === true;
      if (isGroupEpreuve) groupEpreuveIds.add(slot.epreuve.id);

      const slotCandidateIds: string[] = [];

      for (const e of slot.enrollments || []) {
        if (!e.candidate) continue;
        if (!isActiveEnrollment(e.status)) continue;

        const candidateId = e.candidate.id;
        slotCandidateIds.push(candidateId);
        const key = `${candidateId}_${slot.epreuve.id}`;

        if (!candidatesMap.has(key)) {
          candidatesMap.set(key, {
            id: candidateId,
            firstName: e.candidate.first_name,
            lastName: e.candidate.last_name,
            epreuve: {
              ...slot.epreuve,
              isGroupEpreuve,
            },
            slotId: slot.id,
            // Reconstruite depuis le JOUR du créneau : `slot.date` est un
            // timestamptz ("2026-09-15T12:00:00+00:00"), le concaténer tel
            // quel à l'heure donnait une date invalide.
            slotDate: slotStartDate(slot.date, slot.start_time),
            slotStartTime: slot.start_time || null,
            slotEndTime: slot.end_time || null,
            slotRoom: slot.room || null,
          });
        }
      }

      slots.push({
        slotId: slot.id,
        epreuveId: slot.epreuve.id,
        isGroupEpreuve,
        date: slot.date || null,
        startTime: slot.start_time || null,
        endTime: slot.end_time || null,
        room: slot.room || null,
        epreuveName: slot.epreuve.name || "",
        epreuveTour: slot.epreuve.tour ?? null,
        candidateIds: slotCandidateIds,
      });
    }

    const entries = Array.from(candidatesMap.values());
    const candidateIds = Array.from(new Set(entries.map((c) => c.id)));
    const epreuveIds = Array.from(new Set(entries.map((c) => c.epreuve.id)));

    // 3. Toutes les notes déjà posées sur ces couples — celles de TOUS les
    //    examinateurs, pas seulement les miennes : une note partagée de binôme
    //    est saisie par un seul, et sur un business game c'est l'examinateur
    //    désigné qui note le candidat.
    const evaluations: any[] = [];
    const evaluators = new Map<string, any>();

    if (candidateIds.length > 0 && epreuveIds.length > 0) {
      const { data: rows, error: evalsError } = await fetchAllRows<any>(
        (from, to) =>
          supabaseAdmin
            .from("candidate_evaluations")
            .select(
              "id, candidate_id, epreuve_id, member_id, is_group, scores, comment, member:members!member_id(id, first_name, last_name, email)",
            )
            .in("candidate_id", candidateIds)
            .in("epreuve_id", epreuveIds)
            .order("id")
            .range(from, to),
      );

      if (evalsError) throw evalsError;

      for (const row of rows || []) {
        evaluations.push(row);
        if (row.member?.id) evaluators.set(row.member.id, row.member);
      }
    }

    const closureIndex = buildClosureIndex(evaluations, (epreuveId) =>
      groupEpreuveIds.has(epreuveId),
    );

    // 4. Séparation file d'attente / déjà clos.
    const pending: any[] = [];
    const done: any[] = [];

    for (const entry of entries) {
      const verdict = evaluationClosure(closureIndex, {
        candidateId: entry.id,
        epreuveId: entry.epreuve.id,
        memberId,
        isGroupEpreuve: entry.epreuve.isGroupEpreuve === true,
      });

      if (!verdict.closed) {
        pending.push(entry);
        continue;
      }

      const by = verdict.byMemberId ? evaluators.get(verdict.byMemberId) : null;
      done.push({
        ...entry,
        closedReason: verdict.reason as ClosureReason,
        closedBy:
          verdict.reason === "mine"
            ? null
            : { id: verdict.byMemberId, name: memberName(by) },
      });
    }

    // 5. « Qui examine qui » (business games), pour la file d'attente.
    const slotIds = Array.from(
      new Set(pending.map((c) => c.slotId).filter(Boolean)),
    );
    const targetsByKey = new Map<string, any[]>();

    if (slotIds.length > 0) {
      const { data: targets } = await supabaseAdmin
        .from("examiner_targets")
        .select(
          "slot_id, candidate_id, member_id, member:members!member_id(first_name, last_name)",
        )
        .in("slot_id", slotIds);

      for (const t of (targets as any[]) || []) {
        const key = `${t.slot_id}_${t.candidate_id}`;
        if (!targetsByKey.has(key)) targetsByKey.set(key, []);
        targetsByKey.get(key)!.push({
          memberId: t.member_id,
          isMe: t.member_id === memberId,
          firstName: t.member?.first_name || "",
          lastName: t.member?.last_name || "",
        });
      }
    }

    // 6. Lien de business game du créneau, pour l'examinateur qui est devant
    //    le groupe. Les créneaux listés ici viennent tous de mes affectations
    //    (étape 1) : le montrer n'élargit mon accès à rien.
    const links = slotIds.length > 0 ? await fetchSlotLinks(slotIds) : new Map();

    const candidates = pending
      .map((c) => ({
        ...c,
        targets: targetsByKey.get(`${c.slotId}_${c.id}`) || [],
        slotLink: (c.slotId && links.get(c.slotId)) || null,
      }))
      .sort((a, b) => a.slotDate.getTime() - b.slotDate.getTime());

    done.sort((a, b) => b.slotDate.getTime() - a.slotDate.getTime());

    // 7. Alerte de couverture : sur un business game TERMINÉ, tout candidat
    //    sans la moindre note. C'est le filet contre le candidat oublié —
    //    personne ne s'en aperçoit avant la délibération, sinon.
    const nowClock = parisClock();
    const alerts = slots
      .filter(
        (s) =>
          s.isGroupEpreuve &&
          s.candidateIds.length > 0 &&
          slotHasEnded({ date: s.date, end_time: s.endTime }, nowClock),
      )
      .map((s) => {
        const missing = Array.from(new Set(s.candidateIds))
          .filter((cid) => !hasAnyEvaluation(closureIndex, cid, s.epreuveId))
          .map((cid) => {
            const c = candidatesMap.get(`${cid}_${s.epreuveId}`);
            return {
              id: cid,
              name: c ? `${c.firstName || ""} ${c.lastName || ""}`.trim() : "Candidat",
            };
          });
        return {
          slotId: s.slotId,
          epreuveName: s.epreuveName,
          epreuveId: s.epreuveId,
          tour: s.epreuveTour,
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          room: s.room,
          totalCandidates: new Set(s.candidateIds).size,
          missing,
        };
      })
      .filter((a) => a.missing.length > 0)
      .sort((a, b) =>
        slotStartDate(b.date, b.startTime).getTime() -
        slotStartDate(a.date, a.startTime).getTime(),
      );

    return Response.json({ candidates, done, alerts });
  } catch (error) {
    console.error(
      "Error fetching next candidates:",
      (error as PostgrestError)?.message || error,
    );
    return Response.json(
      { error: "Failed to fetch next candidates" },
      { status: 500 },
    );
  }
}
