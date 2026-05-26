import { supabaseAdmin } from "@/lib/supabase";

/**
 * Aligns slot_member_assignments to the availabilities table.
 *
 * Picks N members (= slot.min_members) per slot from those who declared
 * availability at the slot's date+start_time, with fairness (least-assigned
 * first) and no double-booking. Slots already published to candidates
 * are left untouched (their jury is preserved — see toggle-member route
 * for the replacement-notification flow).
 *
 * Returns the list of unfilled slots so callers can trigger alerts/notifs.
 */
export async function runAutoAllocate(opts?: { epreuveId?: string }): Promise<{
  updated: number;
  unfilled: Array<{ slot_id: string; needed: number; got: number }>;
}> {
  // Fetch slots (optionally filtered by épreuve)
  // FIX H3: also pull enrollment count so we can preserve jury for any
  // slot that already has candidates attached — wiping jury after a
  // candidate enrolled silently desyncs everyone.
  let slotQuery = supabaseAdmin
    .from("evaluation_slots")
    .select(
      "id, date, start_time, end_time, status, min_members, epreuve_id, enrollments:slot_enrollments(id, status)",
    );
  if (opts?.epreuveId) slotQuery = slotQuery.eq("epreuve_id", opts.epreuveId);
  const { data: slots, error: slotErr } = await slotQuery;
  if (slotErr) throw slotErr;

  if (!slots || slots.length === 0) return { updated: 0, unfilled: [] };

  // FIX H3: helper — a slot is "committed" if any of:
  //   • status is in {published, ready, full, closed}
  //   • it has at least one active enrollment
  // Committed slots keep their existing jury (no wipe, no re-pick).
  const isCommitted = (s: any): boolean => {
    if (["published", "ready", "full", "closed"].includes(s.status)) {
      return true;
    }
    const actives = (s.enrollments || []).filter(
      (e: any) => !e.status || e.status === "active",
    );
    return actives.length > 0;
  };

  // Fetch all availabilities
  const { data: availabilities } = await supabaseAdmin
    .from("availabilities")
    .select("member_id, date, start_time");

  // Current state
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

  // Match availabilities to slots by date + start_time
  const matchSlotToMembers = (slot: any): string[] => {
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

  // Track load and commitments for fairness + anti-overlap
  const memberLoad: Record<string, number> = {};
  const memberCommittedSlots: Record<
    string,
    Array<{ date: string; start: string; end: string }>
  > = {};

  const wouldConflict = (memberId: string, slot: any): boolean => {
    const committed = memberCommittedSlots[memberId] || [];
    const sDate = String(slot.date || "").substring(0, 10);
    const sStart = String(slot.start_time || "").substring(0, 5);
    const sEnd = String(slot.end_time || "").substring(0, 5);
    return committed.some(
      (c) => c.date === sDate && c.start < sEnd && sStart < c.end,
    );
  };

  const commit = (memberId: string, slot: any) => {
    memberLoad[memberId] = (memberLoad[memberId] || 0) + 1;
    if (!memberCommittedSlots[memberId]) memberCommittedSlots[memberId] = [];
    memberCommittedSlots[memberId].push({
      date: String(slot.date || "").substring(0, 10),
      start: String(slot.start_time || "").substring(0, 5),
      end: String(slot.end_time || "").substring(0, 5),
    });
  };

  // Sort slots chronologically
  const sortedSlots = [...slots].sort((a: any, b: any) => {
    const ad = String(a.date).substring(0, 10);
    const bd = String(b.date).substring(0, 10);
    if (ad !== bd) return ad < bd ? -1 : 1;
    return String(a.start_time).localeCompare(String(b.start_time));
  });

  const assignmentsToInsert: Array<{ slot_id: string; member_id: string }> = [];
  const unfilled: Array<{ slot_id: string; needed: number; got: number }> = [];

  for (const slot of sortedSlots) {
    // FIX H3: preserve jury for ANY committed slot (not just published).
    // Previously only "published" was preserved, which meant a slot in
    // "ready" or "full" with candidates already enrolled would get its
    // members rotated when another member edited their availability.
    if (isCommitted(slot)) {
      const existing = currentBySlot[slot.id] || new Set();
      existing.forEach((memberId) => commit(memberId, slot));
      continue;
    }

    const eligible = matchSlotToMembers(slot);
    const sortedEligible = [...eligible].sort(
      (a, b) => (memberLoad[a] || 0) - (memberLoad[b] || 0),
    );

    const quota = slot.min_members || 2;
    const picked: string[] = [];

    for (const memberId of sortedEligible) {
      if (picked.length >= quota) break;
      if (wouldConflict(memberId, slot)) continue;
      picked.push(memberId);
      commit(memberId, slot);
    }

    picked.forEach((memberId) => {
      assignmentsToInsert.push({ slot_id: slot.id, member_id: memberId });
    });

    if (picked.length < quota) {
      unfilled.push({ slot_id: slot.id, needed: quota, got: picked.length });
    }
  }

  // FIX H3: only wipe assignments for NON-committed slots. Committed
  // slots (published/ready/full/closed OR with enrollments) keep their
  // existing jury — preventing the silent member rotation that broke
  // sync between admin/member views.
  const wipeableSlotIds = sortedSlots
    .filter((s: any) => !isCommitted(s))
    .map((s: any) => s.id);

  if (wipeableSlotIds.length > 0) {
    await supabaseAdmin
      .from("slot_member_assignments")
      .delete()
      .in("slot_id", wipeableSlotIds);
  }

  if (assignmentsToInsert.length > 0) {
    await supabaseAdmin
      .from("slot_member_assignments")
      .insert(assignmentsToInsert);
  }

  // FIX M3: maybeSingle so a missing row doesn't crash auto-allocate.
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

  // Update statuses based on quota et auto-publish si planning visible
  for (const slot of sortedSlots) {
    // FIX H3: don't touch status of committed slots either.
    if (isCommitted(slot)) continue;
    const assignedCount = assignmentsToInsert.filter(
      (a) => a.slot_id === slot.id,
    ).length;

    let newStatus: string;
    if (planningVisibleToCandidates && assignedCount >= 1) {
      // Règle métier: planning publié + au moins 1 examinateur → visible aux candidats
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

  return { updated: assignmentsToInsert.length, unfilled };
}

/**
 * Sends a private message to every member listed in `memberIds`.
 * Best-effort: errors are logged but not thrown.
 */
export async function broadcastReplacementRequest(
  memberIds: string[],
  text: string,
): Promise<void> {
  if (memberIds.length === 0) return;
  try {
    const rows = memberIds.map((id) => ({
      sender_id: null,
      sender_role: "admin",
      sender_name: "Système",
      recipient_id: id,
      recipient_role: "member",
      message: text,
    }));
    await supabaseAdmin.from("private_messages").insert(rows);
  } catch (e) {
    console.error("broadcastReplacementRequest error:", e);
  }
}
