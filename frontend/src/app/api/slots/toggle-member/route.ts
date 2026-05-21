import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { broadcastReplacementRequest } from "@/lib/auto-allocate";
import { NextRequest } from "next/server";

// POST /api/slots/toggle-member — toggle member assignment on a slot
// Features :
// - Anti-double-booking : un membre ne peut pas être affecté à 2 créneaux qui se chevauchent
// - Auto-remplacement : quand un membre est retiré, on promeut automatiquement
//   le premier membre en attente (dans slot_availability_requests) pour ce créneau
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  try {
    const body = await req.json();
    const { slotId, action } = body;
    // Admin peut spécifier un memberId arbitraire, sinon on prend l'utilisateur connecté
    const memberId =
      payload.isAdmin && body.memberId ? body.memberId : payload.id;
    if (!slotId) {
      return Response.json({ error: "slotId required" }, { status: 400 });
    }

    // Check if already assigned
    const { data: existing } = await supabaseAdmin
      .from("slot_member_assignments")
      .select("id")
      .eq("slot_id", slotId)
      .eq("member_id", memberId)
      .limit(1);

    // Si action explicite fournie par l'admin, respecter; sinon toggle
    const shouldRemove =
      action === "remove" || (!action && existing && existing.length > 0);
    const shouldAdd =
      action === "add" || (!action && (!existing || existing.length === 0));

    if (shouldRemove && existing && existing.length > 0) {
      // ──────────────────────────────────────────────────────────────
      // RETRAIT : Supprimer + tenter une auto-promotion depuis la file
      // ──────────────────────────────────────────────────────────────
      const { error: deleteError } = await supabaseAdmin
        .from("slot_member_assignments")
        .delete()
        .eq("id", existing[0].id);

      if (deleteError) throw deleteError;

      // Refetch slot
      const { data: slot } = await supabaseAdmin
        .from("evaluation_slots")
        .select("*, members:slot_member_assignments(member_id)")
        .eq("id", slotId)
        .single();

      let promotedMemberId: string | null = null;

      if (slot) {
        // Liste des membres déjà affectés sur ce créneau
        const assignedIds = new Set(
          (slot.members || []).map((m: any) => m.member_id),
        );

        // Chercher un membre en attente (slot_availability_requests) pour ce créneau,
        // qui n'est pas déjà affecté ET qui n'a pas de conflit horaire
        const { data: waitlist } = await supabaseAdmin
          .from("slot_availability_requests")
          .select("member_id, created_at")
          .eq("slot_id", slotId)
          .order("created_at", { ascending: true });

        if (waitlist && waitlist.length > 0) {
          for (const candidate of waitlist) {
            if (assignedIds.has(candidate.member_id)) continue;

            // Vérifier qu'il n'a pas un autre créneau au même moment
            const hasConflict = await memberHasConflict(
              candidate.member_id,
              slot,
              slotId,
            );
            if (hasConflict) continue;

            // Promouvoir : ajouter à slot_member_assignments
            const { error: promoteErr } = await supabaseAdmin
              .from("slot_member_assignments")
              .insert({ slot_id: slotId, member_id: candidate.member_id });

            if (!promoteErr) {
              promotedMemberId = candidate.member_id;
              break;
            }
          }
        }

        // Status downgrade si toujours en dessous du min après promotion
        const newCount =
          (slot.members?.length || 0) - 1 + (promotedMemberId ? 1 : 0);

        if (
          slot.status === "ready" &&
          newCount < (slot.min_members || 0)
        ) {
          await supabaseAdmin
            .from("evaluation_slots")
            .update({ status: "open" })
            .eq("id", slotId);
        }

        // ────────────────────────────────────────────────────────────────
        // NOTIFICATION DE REMPLACEMENT — règles métier :
        //   1. Le planning est publié aux candidats (slot.status === 'published')
        //   2. Il y avait initialement assez d'examinateurs sur ce créneau
        //   3. L'un d'eux s'est désinscrit (on est dans la branche remove)
        //   4. PERSONNE n'a pris sa place (promotedMemberId === null)
        // → broadcast à tous les membres non encore affectés sur ce créneau
        //   pour demander un remplaçant.
        // ────────────────────────────────────────────────────────────────
        if (
          slot.status === "published" &&
          !promotedMemberId &&
          newCount < (slot.min_members || 0)
        ) {
          const { data: allMembers } = await supabaseAdmin
            .from("members")
            .select("id");

          const targets = (allMembers || [])
            .map((m: any) => m.id)
            .filter((id: string) => id !== memberId);

          const dateStr = slot.date
            ? new Date(slot.date).toLocaleDateString("fr-FR", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })
            : "";
          const startTime = String(slot.start_time || "").substring(0, 5);
          const room = slot.room || "—";

          await broadcastReplacementRequest(
            targets,
            `🆘 Besoin d'un remplaçant — ${dateStr} ${startTime} (${room}). Un examinateur s'est désinscrit et personne en file d'attente. Merci de vous porter volontaire si disponible.`,
          );
        }
      }

      return Response.json({
        action: "removed",
        promoted_member_id: promotedMemberId,
      });
    } else if (shouldAdd) {
      // ──────────────────────────────────────────────────────────────
      // AJOUT : Vérifier anti-double-booking d'abord
      // ──────────────────────────────────────────────────────────────
      const { data: targetSlot } = await supabaseAdmin
        .from("evaluation_slots")
        .select("id, date, start_time, end_time")
        .eq("id", slotId)
        .single();

      if (!targetSlot) {
        return Response.json({ error: "Créneau introuvable" }, { status: 404 });
      }

      const conflict = await memberHasConflict(memberId, targetSlot, slotId);
      if (conflict) {
        return Response.json(
          {
            error:
              "Conflit horaire : ce membre est déjà sur un autre créneau au même moment",
          },
          { status: 409 },
        );
      }

      // Add assignment
      const { error: insertError } = await supabaseAdmin
        .from("slot_member_assignments")
        .insert({ slot_id: slotId, member_id: memberId });

      if (insertError) {
        if (insertError.code === "23505") {
          return Response.json({ error: "Already assigned" }, { status: 400 });
        }
        throw insertError;
      }

      // Check if slot reaches minMembers threshold
      const { data: slot } = await supabaseAdmin
        .from("evaluation_slots")
        .select("*, members:slot_member_assignments(id)")
        .eq("id", slotId)
        .single();

      const memberCount = slot?.members?.length || 0;

      // ──────────────────────────────────────────────────────────────
      // AUTO-PUBLICATION : si le planning est déjà visible aux candidats
      // ET qu'on vient d'atteindre >= 1 examinateur sur ce créneau non
      // encore publié, on le passe automatiquement à "published".
      // Règle métier : "si des examinateurs s'inscrivent par la suite,
      // le créneau s'ouvre et se publie automatiquement".
      // ──────────────────────────────────────────────────────────────
      if (slot && ["open", "draft", "ready"].includes(slot.status)) {
        // Vérifier la visibilité globale du planning
        const { data: settingRow } = await supabaseAdmin
          .from("system_settings")
          .select("value")
          .eq("key", "planning_visible_candidats")
          .single();
        const planningVisible =
          settingRow?.value === "true" || settingRow?.value === true;

        let newStatus: string | null = null;
        if (planningVisible && memberCount >= 1) {
          // Au moins 1 examinateur + planning publié → published
          newStatus = "published";
        } else if (
          slot.status === "open" &&
          memberCount >= (slot.min_members || 0)
        ) {
          // Comportement legacy : open → ready quand minMembers atteint
          newStatus = "ready";
        }

        if (newStatus && newStatus !== slot.status) {
          await supabaseAdmin
            .from("evaluation_slots")
            .update({ status: newStatus })
            .eq("id", slotId);
        }
      }

      return Response.json({ action: "added", memberCount });
    } else {
      return Response.json({ action: "no_change" });
    }
  } catch (error) {
    console.error("Toggle member slot error:", error);
    return Response.json(
      { error: "Failed to toggle slot assignment" },
      { status: 500 },
    );
  }
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────
async function memberHasConflict(
  memberId: string,
  targetSlot: { id: string; date: string; start_time: string; end_time: string },
  excludeSlotId: string,
): Promise<boolean> {
  // Récupérer toutes les autres affectations du membre à la même date
  const { data: otherSlots } = await supabaseAdmin
    .from("slot_member_assignments")
    .select("slot:evaluation_slots(id, date, start_time, end_time)")
    .eq("member_id", memberId);

  if (!otherSlots || otherSlots.length === 0) return false;

  const targetDate = (targetSlot.date || "").substring(0, 10);
  const targetStart = targetSlot.start_time;
  const targetEnd = targetSlot.end_time;

  for (const row of otherSlots as any[]) {
    const s = row.slot;
    if (!s || s.id === excludeSlotId) continue;

    const sDate = (s.date || "").substring(0, 10);
    if (sDate !== targetDate) continue;

    // Overlap check : start1 < end2 && start2 < end1
    if (
      timeLt(targetStart, s.end_time) &&
      timeLt(s.start_time, targetEnd)
    ) {
      return true;
    }
  }

  return false;
}

function timeLt(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a < b;
}
