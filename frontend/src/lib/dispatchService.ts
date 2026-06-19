import { supabaseAdmin } from "@/lib/supabase";

/**
 * Dispatch Service — Algorithme de répartition intelligente des examinateurs.
 *
 * Enrichit le système d'auto-allocate existant avec :
 *   1. Équité (fairness) — priorité absolue aux membres à 0 créneau
 *   2. Brassage (anti-binôme) — pénalise les paires récurrentes
 *   3. Liste d'attente / Backup — 2 remplaçants par créneau
 *   4. Notifications — alerte quand un membre est désinscrit pour équité
 *   5. Gel à 24h — ne touche plus au planning dans les 24h avant l'épreuve
 *
 * Déclencheurs :
 *   - Admin clique "Publier"
 *   - Membre sauvegarde ses disponibilités
 *   - Appel API explicite
 *
 * Utilise directement Supabase (comme auto-allocate.ts existant).
 */

// ─── Constants ────────────────────────────────────────────────────────
const FREEZE_HOURS = 24;
const BACKUP_COUNT = 2; // Nombre de remplaçants par créneau
const PAIR_PENALTY_WEIGHT = 2; // Multiplicateur pénalité binôme

// ─── Types ────────────────────────────────────────────────────────────
interface DispatchResult {
  updated: number;
  backupsAssigned: number;
  unfilled: Array<{ slot_id: string; needed: number; got: number }>;
  frozen: number;
  notifications: number;
}

interface SlotInfo {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  min_members: number;
  epreuve_id: string | null;
  enrollments?: Array<{ id: string; status?: string }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Canonical pair key (alphabetically sorted for uniqueness) */
function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/** Check if a slot is frozen (< 24h before start) */
function isFrozen(slot: SlotInfo): boolean {
  const dateStr = String(slot.date || "").substring(0, 10);
  const timeStr = String(slot.start_time || "08:00").substring(0, 5);
  const slotDate = new Date(`${dateStr}T${timeStr}:00`);
  const now = new Date();
  return slotDate.getTime() - now.getTime() < FREEZE_HOURS * 3600 * 1000;
}

/**
 * Check if a slot's jury is locked (must NOT be reshuffled by the dispatch).
 *
 * IMPORTANT : la répartition des EXAMINATEURS est indépendante de l'état
 * candidat. On ne verrouille QUE les créneaux clôturés (`closed`) — l'épreuve
 * est passée. Tout le reste (open/ready/published/full + créneaux avec
 * candidats inscrits) reste rééquilibrable : on veut pouvoir distribuer
 * équitablement les examinateurs (2 par créneau, en rotation) même après que
 * le planning est publié ou que des candidats se sont inscrits.
 *
 * Les inscriptions candidats vivent dans une table séparée (slot_enrollments)
 * et ne sont JAMAIS touchées par le dispatch : rééquilibrer le jury ne les
 * impacte pas. La fenêtre de gel des 24h (isFrozen) reste le second verrou.
 */
function isCommitted(slot: SlotInfo): boolean {
  return slot.status === "closed";
}

/** Check temporal overlap between a member's committed slots and a candidate slot */
function wouldConflict(
  memberId: string,
  slot: SlotInfo,
  memberCommittedSlots: Record<
    string,
    Array<{ date: string; start: string; end: string }>
  >,
): boolean {
  const committed = memberCommittedSlots[memberId] || [];
  const sDate = String(slot.date || "").substring(0, 10);
  const sStart = String(slot.start_time || "").substring(0, 5);
  const sEnd = String(slot.end_time || "").substring(0, 5);
  return committed.some(
    (c) => c.date === sDate && c.start < sEnd && sStart < c.end,
  );
}

/** Record a member commitment to a slot for overlap tracking */
function commitMember(
  memberId: string,
  slot: SlotInfo,
  memberLoad: Record<string, number>,
  memberCommittedSlots: Record<
    string,
    Array<{ date: string; start: string; end: string }>
  >,
): void {
  memberLoad[memberId] = (memberLoad[memberId] || 0) + 1;
  if (!memberCommittedSlots[memberId]) memberCommittedSlots[memberId] = [];
  memberCommittedSlots[memberId].push({
    date: String(slot.date || "").substring(0, 10),
    start: String(slot.start_time || "").substring(0, 5),
    end: String(slot.end_time || "").substring(0, 5),
  });
}

/**
 * Score a member for assignment to a slot.
 * Lower score = better candidate.
 * Combines:
 *   - Load (number of existing assignments) — for equity
 *   - Pair penalty — for diversity/brassage
 */
function scoreMember(
  memberId: string,
  alreadyPicked: string[],
  memberLoad: Record<string, number>,
  pairHistory: Map<string, number>,
): number {
  const loadScore = memberLoad[memberId] || 0;
  let pairPenalty = 0;
  for (const other of alreadyPicked) {
    const key = pairKey(memberId, other);
    pairPenalty += (pairHistory.get(key) || 0) * PAIR_PENALTY_WEIGHT;
  }
  return loadScore + pairPenalty;
}

// ─── Main Dispatch Function ───────────────────────────────────────────

export async function runDispatch(opts?: {
  epreuveId?: string;
}): Promise<DispatchResult> {
  // 1. Fetch slots with enrollments
  let slotQuery = supabaseAdmin
    .from("evaluation_slots")
    .select(
      "id, date, start_time, end_time, status, min_members, epreuve_id, enrollments:slot_enrollments(id, status)",
    );
  if (opts?.epreuveId) slotQuery = slotQuery.eq("epreuve_id", opts.epreuveId);
  const { data: slots, error: slotErr } = await slotQuery;
  if (slotErr) throw slotErr;
  if (!slots || slots.length === 0)
    return {
      updated: 0,
      backupsAssigned: 0,
      unfilled: [],
      frozen: 0,
      notifications: 0,
    };

  // 2. Fetch all availabilities
  const { data: availabilities } = await supabaseAdmin
    .from("availabilities")
    .select("member_id, date, start_time");

  // 3. Fetch current assignments
  const slotIds = slots.map((s: any) => s.id);
  const { data: currentAssigns } = await supabaseAdmin
    .from("slot_member_assignments")
    .select("slot_id, member_id")
    .in("slot_id", slotIds);

  const currentBySlot: Record<string, Set<string>> = {};
  (currentAssigns || []).forEach((a: any) => {
    if (!currentBySlot[a.slot_id]) currentBySlot[a.slot_id] = new Set();
    currentBySlot[a.slot_id].add(a.member_id);
  });

  // 4. Build pair history from current assignments across ALL slots
  // (not just the ones we're processing — we want global brassage)
  const { data: allAssignments } = await supabaseAdmin
    .from("slot_member_assignments")
    .select("slot_id, member_id");

  const pairHistory = new Map<string, number>();
  const slotMembers: Record<string, string[]> = {};
  (allAssignments || []).forEach((a: any) => {
    if (!slotMembers[a.slot_id]) slotMembers[a.slot_id] = [];
    slotMembers[a.slot_id].push(a.member_id);
  });
  // Count pair co-occurrences across all slots
  Object.values(slotMembers).forEach((members) => {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const key = pairKey(members[i], members[j]);
        pairHistory.set(key, (pairHistory.get(key) || 0) + 1);
      }
    }
  });

  // 5. Match availabilities to slots by date + start_time
  const matchSlotToMembers = (slot: SlotInfo): string[] => {
    const slotDate = String(slot.date || "").substring(0, 10);
    const slotStart = String(slot.start_time || "").substring(0, 5);
    const matches: string[] = [];
    (availabilities || []).forEach((av: any) => {
      const avDate = String(av.date || "").substring(0, 10);
      const avStart = String(av.start_time || "").substring(0, 5);
      if (avDate === slotDate && avStart === slotStart) {
        if (av.member_id && !matches.includes(av.member_id)) {
          matches.push(av.member_id);
        }
      }
    });
    return matches;
  };

  // 6. Sort slots chronologically
  const sortedSlots = [...slots].sort((a: any, b: any) => {
    const ad = String(a.date).substring(0, 10);
    const bd = String(b.date).substring(0, 10);
    if (ad !== bd) return ad < bd ? -1 : 1;
    return String(a.start_time).localeCompare(String(b.start_time));
  });

  // 7. Tracking structures
  const memberLoad: Record<string, number> = {};
  const memberCommittedSlots: Record<
    string,
    Array<{ date: string; start: string; end: string }>
  > = {};

  const assignmentsToInsert: Array<{ slot_id: string; member_id: string }> = [];
  const backupAssignments: Array<{ slot_id: string; member_id: string }> = [];
  const unfilled: Array<{ slot_id: string; needed: number; got: number }> = [];
  const removedMembers: Array<{
    member_id: string;
    slot: SlotInfo;
    reason: string;
  }> = [];

  let frozenCount = 0;

  // 8. Pre-populate load from committed/frozen slots
  for (const slot of sortedSlots) {
    if (isFrozen(slot as SlotInfo) || isCommitted(slot as SlotInfo)) {
      const existing = currentBySlot[slot.id] || new Set<string>();
      existing.forEach((memberId) =>
        commitMember(
          memberId,
          slot as SlotInfo,
          memberLoad,
          memberCommittedSlots,
        ),
      );
    }
  }

  // 9. Main allocation loop
  for (const slot of sortedSlots) {
    const existing = currentBySlot[slot.id] || new Set<string>();
    const slotInfo = slot as SlotInfo;

    // 9a. Frozen slots — don't touch
    if (isFrozen(slotInfo)) {
      frozenCount++;
      continue;
    }

    // 9b. Committed slots — preserve jury, only add if understaffed
    if (isCommitted(slotInfo)) {
      existing.forEach((memberId) => {
        if (!memberCommittedSlots[memberId]?.some(
          (c) =>
            c.date === String(slot.date).substring(0, 10) &&
            c.start === String(slot.start_time).substring(0, 5),
        )) {
          commitMember(memberId, slotInfo, memberLoad, memberCommittedSlots);
        }
      });

      // Try to fill gaps if understaffed
      const quota = slot.min_members || 2;
      if (existing.size < quota) {
        const eligible = matchSlotToMembers(slotInfo).filter(
          (id) => !existing.has(id),
        );
        const scored = eligible
          .map((id) => ({
            id,
            score: scoreMember(id, Array.from(existing), memberLoad, pairHistory),
          }))
          .sort((a, b) => a.score - b.score);

        let added = 0;
        for (const { id } of scored) {
          if (existing.size + added >= quota) break;
          if (wouldConflict(id, slotInfo, memberCommittedSlots)) continue;
          assignmentsToInsert.push({ slot_id: slot.id, member_id: id });
          commitMember(id, slotInfo, memberLoad, memberCommittedSlots);
          // Update pair history
          Array.from(existing).forEach((otherId) => {
            const key = pairKey(id, otherId);
            pairHistory.set(key, (pairHistory.get(key) || 0) + 1);
          });
          added++;
        }
      }
      continue;
    }

    // 9c. Open slots — full re-allocation with brassage + equity
    const eligible = matchSlotToMembers(slotInfo);
    const quota = slot.min_members || 2;
    const picked: string[] = [];

    // Sort by composite score (load + pair penalty)
    // On first pass, alreadyPicked is empty so we use pure load
    // Then progressively factor in pair penalties
    const sortedEligible = [...eligible].sort(
      (a, b) =>
        scoreMember(a, picked, memberLoad, pairHistory) -
        scoreMember(b, picked, memberLoad, pairHistory),
    );

    for (const memberId of sortedEligible) {
      if (picked.length >= quota) break;
      if (wouldConflict(memberId, slotInfo, memberCommittedSlots)) continue;
      picked.push(memberId);
      commitMember(memberId, slotInfo, memberLoad, memberCommittedSlots);
      // Update pair history for next picks
      for (const other of picked.slice(0, -1)) {
        const key = pairKey(memberId, other);
        pairHistory.set(key, (pairHistory.get(key) || 0) + 1);
      }
    }

    picked.forEach((memberId) => {
      assignmentsToInsert.push({ slot_id: slot.id, member_id: memberId });
    });

    // 9d. Backups — pick 2 more after titulaires
    const remainingEligible = eligible
      .filter((id) => !picked.includes(id))
      .sort(
        (a, b) =>
          scoreMember(a, picked, memberLoad, pairHistory) -
          scoreMember(b, picked, memberLoad, pairHistory),
      );

    const backups: string[] = [];
    for (const memberId of remainingEligible) {
      if (backups.length >= BACKUP_COUNT) break;
      if (wouldConflict(memberId, slotInfo, memberCommittedSlots)) continue;
      backups.push(memberId);
      // Don't increment load for backups — they're on standby
    }

    backups.forEach((memberId) => {
      backupAssignments.push({ slot_id: slot.id, member_id: memberId });
    });

    // 9e. Track unfilled slots
    if (picked.length < quota) {
      unfilled.push({
        slot_id: slot.id,
        needed: quota,
        got: picked.length,
      });
    }

    // 9f. Detect members who were previously assigned but aren't now (equity-driven removal)
    existing.forEach((memberId) => {
      if (!picked.includes(memberId) && !backups.includes(memberId)) {
        removedMembers.push({
          member_id: memberId,
          slot: slotInfo,
          reason: "répartition d'équité",
        });
      }
    });
  }

  // 10. Write assignments to DB
  // Delete existing assignments for non-committed, non-frozen slots
  const wipeableSlotIds = sortedSlots
    .filter((s: any) => !isCommitted(s as SlotInfo) && !isFrozen(s as SlotInfo))
    .map((s: any) => s.id);

  if (wipeableSlotIds.length > 0) {
    await supabaseAdmin
      .from("slot_member_assignments")
      .delete()
      .in("slot_id", wipeableSlotIds);
  }

  // Insert titulaire assignments
  if (assignmentsToInsert.length > 0) {
    const { error: insertErr } = await supabaseAdmin
      .from("slot_member_assignments")
      .insert(assignmentsToInsert);
    if (insertErr) console.error("Insert assignments error:", insertErr);
  }

  // Insert backup assignments into evaluator_allocations table
  // (with statut = 'en_attente')
  if (backupAssignments.length > 0) {
    // First clean up old backup allocations for wipeable slots
    if (wipeableSlotIds.length > 0) {
      await supabaseAdmin
        .from("evaluator_allocations")
        .delete()
        .in("slot_id", wipeableSlotIds)
        .eq("statut", "en_attente");
    }

    const backupRows = backupAssignments.map((ba, idx) => {
      // Find the epreuve_id for this slot
      const slot = sortedSlots.find((s: any) => s.id === ba.slot_id);
      return {
        epreuve_id: (slot as any)?.epreuve_id || null,
        member_id: ba.member_id,
        slot_id: ba.slot_id,
        rang_priorite: idx + 1,
        score_priorite: 0,
        statut: "en_attente",
      };
    });

    // Insert one by one to handle potential conflicts gracefully
    for (const row of backupRows) {
      try {
        if (row.epreuve_id) {
          await supabaseAdmin
            .from("evaluator_allocations")
            .upsert(row, { onConflict: "slot_id,member_id" });
        }
      } catch (e: any) {
        if (e?.code !== "23505") {
          console.error("Backup allocation insert error:", e);
        }
      }
    }
  }

  // 11. Update slot statuses
  let planningVisibleToCandidates = false;
  try {
    const { data: row } = await supabaseAdmin
      .from("system_settings")
      .select("value")
      .eq("key", "planning_visible_candidats")
      .maybeSingle();
    planningVisibleToCandidates = row?.value === "true" || row?.value === true;
  } catch {
    planningVisibleToCandidates = false;
  }

  for (const slot of sortedSlots) {
    if (isCommitted(slot as SlotInfo) || isFrozen(slot as SlotInfo)) continue;

    const assignedCount = assignmentsToInsert.filter(
      (a) => a.slot_id === slot.id,
    ).length;

    let newStatus: string;
    if (planningVisibleToCandidates && assignedCount >= 1) {
      newStatus = "published";
    } else if (assignedCount >= (slot.min_members || 2)) {
      newStatus = "ready";
    } else {
      newStatus = "open";
    }

    if (slot.status !== newStatus) {
      await supabaseAdmin
        .from("evaluation_slots")
        .update({ status: newStatus })
        .eq("id", slot.id);
    }
  }

  // 12. Send notifications for removed members
  let notificationCount = 0;
  for (const removal of removedMembers) {
    try {
      const dateStr = String(removal.slot.date || "").substring(0, 10);
      const startStr = String(removal.slot.start_time || "").substring(0, 5);

      // Format date for human display
      const dateObj = new Date(`${dateStr}T12:00:00`);
      const dateDisplay = dateObj.toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });

      await supabaseAdmin.from("notifications").insert({
        member_id: removal.member_id,
        type: "dispatch_change",
        title: "Changement d'affectation",
        body: `Vous avez été retiré du créneau de ${startStr} le ${dateDisplay} (raison : ${removal.reason}). Un autre examinateur a été prioritairement affecté pour garantir l'équité de répartition.`,
        link: "/dashboard",
      });
      notificationCount++;
    } catch (e) {
      console.error("Notification insert error:", e);
    }
  }

  // 13. Log to allocation_history for audit trail
  try {
    const statsPayload = {
      total_slots: sortedSlots.length,
      assigned: assignmentsToInsert.length,
      backups: backupAssignments.length,
      unfilled: unfilled.length,
      frozen: frozenCount,
      notifications: notificationCount,
      member_load: memberLoad,
      pair_diversity: Object.fromEntries(pairHistory),
    };

    await supabaseAdmin.from("allocation_history").insert({
      epreuve_id: opts?.epreuveId || sortedSlots[0]?.epreuve_id || null,
      version: Date.now(), // Use timestamp as version for simplicity
      allocations: JSON.stringify(assignmentsToInsert),
      statistiques: JSON.stringify(statsPayload),
      triggered_by: opts?.epreuveId
        ? "dispatch_epreuve"
        : "dispatch_global",
    });
  } catch (e) {
    console.error("Allocation history insert error:", e);
  }

  return {
    updated: assignmentsToInsert.length,
    backupsAssigned: backupAssignments.length,
    unfilled,
    frozen: frozenCount,
    notifications: notificationCount,
  };
}
