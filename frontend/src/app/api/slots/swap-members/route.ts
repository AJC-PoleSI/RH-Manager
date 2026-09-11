import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { timeOverlaps } from "@/lib/dispatch-core";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// POST /api/slots/swap-members — échange deux examinateurs entre deux créneaux.
//
// Pourquoi une route dédiée plutôt que quatre appels à /slots/toggle-member :
// un retrait via toggle-member promeut automatiquement un membre de la liste
// d'attente et peut faire retomber le créneau en "open", et l'anti-double-
// booking refuserait d'ajouter A sur le créneau de B tant que A occupe encore
// le sien. Ici l'effectif de chaque créneau est inchangé par construction :
// aucun statut à recalculer, aucune promotion à déclencher.

interface SlotRow {
  id: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  room: string | null;
  epreuve_id: string | null;
}

function conflict(message: string) {
  return Response.json({ error: message }, { status: 409 });
}

/** Un examinateur a-t-il déjà noté un candidat inscrit sur ce créneau ? */
async function hasRecordedEvaluation(memberId: string, slot: SlotRow) {
  const { data: enrollments } = await supabaseAdmin
    .from("slot_enrollments")
    .select("candidate_id, status")
    .eq("slot_id", slot.id);

  const candidateIds = (enrollments || [])
    .filter((e: any) => !e.status || e.status === "active")
    .map((e: any) => e.candidate_id);

  if (candidateIds.length === 0 || !slot.epreuve_id) return false;

  const { data: evaluations } = await supabaseAdmin
    .from("candidate_evaluations")
    .select("id")
    .eq("member_id", memberId)
    .eq("epreuve_id", slot.epreuve_id)
    .in("candidate_id", candidateIds)
    .limit(1);

  return (evaluations || []).length > 0;
}

/** Le membre a-t-il un autre engagement qui chevauche le créneau cible ? */
async function hasOverlappingCommitment(
  memberId: string,
  target: SlotRow,
  excludedSlotIds: string[],
) {
  const { data: rows } = await supabaseAdmin
    .from("slot_member_assignments")
    .select("slot:evaluation_slots(id, date, start_time, end_time)")
    .eq("member_id", memberId);

  return (rows || []).some((row: any) => {
    const s = row.slot;
    if (!s || excludedSlotIds.includes(s.id)) return false;
    if (String(s.date).substring(0, 10) !== String(target.date).substring(0, 10))
      return false;
    return timeOverlaps(
      String(s.start_time || "").substring(0, 5),
      String(s.end_time || "").substring(0, 5),
      String(target.start_time || "").substring(0, 5),
      String(target.end_time || "").substring(0, 5),
    );
  });
}

export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (payload.role !== "member" || !payload.isAdmin) return forbidden();

  try {
    const { slotAId, memberAId, slotBId, memberBId } = await req.json();

    if (!slotAId || !memberAId || !slotBId || !memberBId) {
      return Response.json(
        { error: "slotAId, memberAId, slotBId et memberBId sont requis" },
        { status: 400 },
      );
    }
    if (slotAId === slotBId) {
      return conflict("Les deux examinateurs sont déjà sur le même créneau.");
    }
    if (memberAId === memberBId) {
      return conflict("Sélectionnez deux examinateurs différents.");
    }

    const { data: slots, error: slotsError } = await supabaseAdmin
      .from("evaluation_slots")
      .select("id, date, start_time, end_time, room, epreuve_id")
      .in("id", [slotAId, slotBId]);

    if (slotsError) throw slotsError;

    const slotA = (slots || []).find((s: any) => s.id === slotAId) as SlotRow;
    const slotB = (slots || []).find((s: any) => s.id === slotBId) as SlotRow;
    if (!slotA || !slotB) {
      return Response.json({ error: "Créneau introuvable" }, { status: 404 });
    }

    if (slotA.epreuve_id !== slotB.epreuve_id) {
      return conflict(
        "Échange refusé : les deux créneaux ne portent pas sur la même épreuve.",
      );
    }

    const { data: assignments, error: assignError } = await supabaseAdmin
      .from("slot_member_assignments")
      .select("id, slot_id, member_id")
      .in("slot_id", [slotAId, slotBId])
      .in("member_id", [memberAId, memberBId]);

    if (assignError) throw assignError;

    const rowA = (assignments || []).find(
      (a: any) => a.slot_id === slotAId && a.member_id === memberAId,
    );
    const rowB = (assignments || []).find(
      (a: any) => a.slot_id === slotBId && a.member_id === memberBId,
    );
    if (!rowA || !rowB) {
      return conflict(
        "Un des examinateurs n'est plus affecté à son créneau — rechargez le planning.",
      );
    }

    // UNIQUE(slot_id, member_id) : l'échange échouerait si le membre est déjà
    // présent sur le créneau d'arrivée.
    const alreadyThere = (assignments || []).find(
      (a: any) =>
        (a.slot_id === slotBId && a.member_id === memberAId) ||
        (a.slot_id === slotAId && a.member_id === memberBId),
    );
    if (alreadyThere) {
      return conflict(
        "Échange impossible : un des examinateurs est déjà affecté au créneau d'arrivée.",
      );
    }

    if (await hasRecordedEvaluation(memberAId, slotA)) {
      return conflict(
        "Échange refusé : le premier examinateur a déjà saisi une évaluation sur son créneau.",
      );
    }
    if (await hasRecordedEvaluation(memberBId, slotB)) {
      return conflict(
        "Échange refusé : le second examinateur a déjà saisi une évaluation sur son créneau.",
      );
    }

    const excluded = [slotAId, slotBId];
    if (await hasOverlappingCommitment(memberAId, slotB, excluded)) {
      return conflict(
        "Échange refusé : le premier examinateur est déjà pris sur un autre créneau à cet horaire.",
      );
    }
    if (await hasOverlappingCommitment(memberBId, slotA, excluded)) {
      return conflict(
        "Échange refusé : le second examinateur est déjà pris sur un autre créneau à cet horaire.",
      );
    }

    const { error: moveAError } = await supabaseAdmin
      .from("slot_member_assignments")
      .update({ slot_id: slotBId })
      .eq("id", rowA.id);
    if (moveAError) throw moveAError;

    const { error: moveBError } = await supabaseAdmin
      .from("slot_member_assignments")
      .update({ slot_id: slotAId })
      .eq("id", rowB.id);

    if (moveBError) {
      // Pas de transaction multi-requêtes côté Supabase JS : on remet le
      // premier examinateur en place plutôt que de laisser un créneau vidé.
      await supabaseAdmin
        .from("slot_member_assignments")
        .update({ slot_id: slotAId })
        .eq("id", rowA.id);
      throw moveBError;
    }

    return Response.json({
      success: true,
      swapped: [
        { memberId: memberAId, from: slotA.room, to: slotB.room },
        { memberId: memberBId, from: slotB.room, to: slotA.room },
      ],
    });
  } catch (error) {
    console.error("Swap members error:", error);
    return Response.json({ error: "Échange impossible" }, { status: 500 });
  }
}
