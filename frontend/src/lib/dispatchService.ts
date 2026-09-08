import { supabaseAdmin } from "@/lib/supabase";
import {
  pairKey,
  isFrozen,
  scoreMember,
  availabilityMatchesSlot,
  compareByTension,
} from "@/lib/dispatch-core";
import { applyAssignments, type DispatchClient } from "@/lib/dispatch-io";

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
const BACKUP_COUNT = 2; // Nombre de remplaçants par créneau

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
  epreuve?: { is_group_epreuve?: boolean | null } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────
// pairKey / isFrozen / scoreMember / availabilityMatchesSlot vivent dans
// dispatch-core.ts (logique pure, testée unitairement).

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

// ─── Main Dispatch Function ───────────────────────────────────────────

export async function runDispatch(opts?: {
  epreuveId?: string;
}): Promise<DispatchResult> {
  // 1. Fetch slots with enrollments
  let slotQuery = supabaseAdmin
    .from("evaluation_slots")
    .select(
      "id, date, start_time, end_time, status, min_members, epreuve_id, enrollments:slot_enrollments(id, status), epreuve:epreuves(is_group_epreuve)",
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

  // 2. Fetch all availabilities (end_time inclus pour le matching par
  // chevauchement horaire — cf. availabilityMatchesSlot).
  //
  // `epreuve_id` porte l'épreuve pour laquelle la dispo a été cochée. Elle
  // départage deux épreuves dont les horaires ne coïncident que partiellement
  // (cf. availabilityMatchesSlot). Tant que la colonne n'est pas posée en base,
  // on retombe sur la lecture d'origine : toutes les dispos sont alors
  // purement horaires et le comportement reste celui d'avant.
  let availabilities: any[] | null = null;
  {
    const withEpreuve = await supabaseAdmin
      .from("availabilities")
      .select("member_id, date, start_time, end_time, epreuve_id");

    if (withEpreuve.error) {
      const plain = await supabaseAdmin
        .from("availabilities")
        .select("member_id, date, start_time, end_time");
      availabilities = plain.data;
      console.warn(
        "[dispatch] Colonne availabilities.epreuve_id absente — une dispo " +
          "cochée sur une épreuve rend disponible pour toute épreuve au même " +
          "moment. Appliquez la section « dispos par épreuve » de " +
          "MIGRATIONS_A_APPLIQUER.sql.",
      );
    } else {
      availabilities = withEpreuve.data;
    }
  }

  // 3. Fetch current assignments
  const slotIds = slots.map((s: any) => s.id);
  // On lit aussi `is_manual` : un examinateur placé À LA MAIN par l'admin
  // (toggle-member) épingle son créneau, que le dispatch ne doit plus
  // rebrasser. Tant que la colonne n'est pas posée en base, on retombe sur la
  // lecture d'origine et le comportement reste celui d'avant.
  let currentAssigns: any[] | null = null;
  {
    const withManual = await supabaseAdmin
      .from("slot_member_assignments")
      .select("slot_id, member_id, is_manual")
      .in("slot_id", slotIds);

    if (withManual.error) {
      const plain = await supabaseAdmin
        .from("slot_member_assignments")
        .select("slot_id, member_id")
        .in("slot_id", slotIds);
      currentAssigns = plain.data;
      console.warn(
        "[dispatch] Colonne slot_member_assignments.is_manual absente — les " +
          "affectations manuelles ne sont PAS protégées du rebrassage. " +
          "Appliquez la section « dispatch : affectations manuelles » de " +
          "MIGRATIONS_A_APPLIQUER.sql.",
      );
    } else {
      currentAssigns = withManual.data;
    }
  }

  // Créneaux « épinglés » : au moins un examinateur y a été placé à la main.
  //
  // Audit fonctionnel du 07/09/2026 : sans cette notion, TOUTE sauvegarde de
  // disponibilités par n'importe quel membre relançait un dispatch global qui
  // pouvait défaire, sans prévenir l'admin, un jury qu'il avait composé
  // manuellement pour une raison métier. Un créneau épinglé est désormais
  // traité comme un créneau clôturé : son jury est conservé, on ne fait que le
  // compléter s'il est en sous-effectif. Retirer l'affectation manuelle
  // (toggle-member) le rend à nouveau rebrassable.
  const manualSlotIds = new Set<string>();
  (currentAssigns || []).forEach((a: any) => {
    if (a?.is_manual) manualSlotIds.add(a.slot_id);
  });
  const isLocked = (slot: SlotInfo | { id: string; status?: string }): boolean =>
    isCommitted(slot as SlotInfo) || manualSlotIds.has((slot as any).id);

  const currentBySlot: Record<string, Set<string>> = {};
  (currentAssigns || []).forEach((a: any) => {
    if (!currentBySlot[a.slot_id]) currentBySlot[a.slot_id] = new Set();
    currentBySlot[a.slot_id].add(a.member_id);
  });

  // 4. (Le brassage / pairHistory est désormais calculé PAR ÉPREUVE dans la
  // boucle d'allocation — voir étape 9. La charge (équité) et la diversité
  // des binômes se mesurent à l'intérieur d'une même épreuve, pas en mélangeant
  // entretiens individuels et épreuves de groupe.)

  // 5. Match availabilities to slots par chevauchement horaire (une dispo qui
  // englobe le créneau compte, même si les heures de début diffèrent).
  // Mémoïsé : la liste est relue plusieurs fois par créneau (titulaires,
  // remplaçants, calcul de tension) et sert de base au tri global.
  const eligibleBySlot = new Map<string, string[]>();
  const matchSlotToMembers = (slot: SlotInfo): string[] => {
    const cached = eligibleBySlot.get(slot.id);
    if (cached) return cached;
    const matches: string[] = [];
    (availabilities || []).forEach((av: any) => {
      if (!availabilityMatchesSlot(av, slot)) return;
      if (av.member_id && !matches.includes(av.member_id)) {
        matches.push(av.member_id);
      }
    });
    eligibleBySlot.set(slot.id, matches);
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
  //
  // memberCommittedSlots est GLOBAL (toutes épreuves confondues) : il sert à
  // empêcher le double-booking temporel — un examinateur ne peut pas être sur
  // deux créneaux qui se chevauchent, même s'ils relèvent d'épreuves
  // différentes.
  const memberCommittedSlots: Record<
    string,
    Array<{ date: string; start: string; end: string }>
  > = {};

  const assignmentsToInsert: Array<{ slot_id: string; member_id: string }> = [];
  const backupAssignments: Array<{ slot_id: string; member_id: string }> = [];
  // Examinateurs disponibles sur un créneau mais placés sur une épreuve
  // concurrente au même horaire : ils rejoignent la liste d'attente du créneau
  // qu'ils n'ont pas obtenu (cf. étape 9d puis étape 10bis).
  const arbitrationLosers: Array<{ slot_id: string; member_id: string }> = [];
  const unfilled: Array<{ slot_id: string; needed: number; got: number }> = [];
  const removedMembers: Array<{
    member_id: string;
    slot: SlotInfo;
    reason: string;
  }> = [];

  let frozenCount = 0;

  // 8. Pré-charge GLOBALE des conflits : enregistre les membres des créneaux
  // gelés/clôturés pour éviter tout double-booking inter-épreuves. (On ne
  // touche PAS à la charge ici — la charge est recalculée par épreuve.)
  const registerConflict = (memberId: string, slot: SlotInfo) => {
    if (!memberCommittedSlots[memberId]) memberCommittedSlots[memberId] = [];
    memberCommittedSlots[memberId].push({
      date: String(slot.date || "").substring(0, 10),
      start: String(slot.start_time || "").substring(0, 5),
      end: String(slot.end_time || "").substring(0, 5),
    });
  };
  for (const slot of sortedSlots) {
    if (isFrozen(slot as SlotInfo) || isLocked(slot as SlotInfo)) {
      const existing = currentBySlot[slot.id] || new Set<string>();
      existing.forEach((memberId) => registerConflict(memberId, slot as SlotInfo));
    }
  }

  // 9. Allocation : état d'équité PAR ÉPREUVE, ordre de passage GLOBAL.
  //
  // Équité (charge) et brassage (binômes) restent calculés au sein d'une même
  // épreuve : un examinateur qui a déjà fait 2 entretiens individuels n'est pas
  // pénalisé pour les épreuves de groupe, et chaque épreuve garde sa rotation.
  //
  // En revanche l'ORDRE dans lequel les créneaux se servent est GLOBAL et suit
  // leur TENSION (examinateurs disponibles − quota) : le créneau qui manque le
  // plus d'examinateurs choisit en premier. C'est ce qui tranche le cas « un
  // examinateur s'est inscrit sur deux épreuves qui se chevauchent » : il est
  // placé là où il manque vraiment, et reste remplaçant sur l'autre (étape 9d).
  const epreuveKeyOf = (slot: SlotInfo): string =>
    slot.epreuve_id || "__sans_epreuve__";

  const slotsByEpreuve = new Map<string, SlotInfo[]>();
  for (const slot of sortedSlots) {
    const key = epreuveKeyOf(slot as SlotInfo);
    if (!slotsByEpreuve.has(key)) slotsByEpreuve.set(key, []);
    slotsByEpreuve.get(key)!.push(slot as SlotInfo);
  }

  // État équité + brassage PROPRE à chaque épreuve, pré-chargé depuis les
  // créneaux gelés / clôturés de cette même épreuve.
  const stateByEpreuve = new Map<
    string,
    { memberLoad: Record<string, number>; pairHistory: Map<string, number> }
  >();
  for (const [key, epreuveSlots] of Array.from(slotsByEpreuve.entries())) {
    const memberLoad: Record<string, number> = {};
    const pairHistory = new Map<string, number>();
    for (const slot of epreuveSlots) {
      if (isFrozen(slot) || isLocked(slot)) {
        const existing = currentBySlot[slot.id] || new Set<string>();
        existing.forEach((memberId) => {
          memberLoad[memberId] = (memberLoad[memberId] || 0) + 1;
        });
      }
    }
    stateByEpreuve.set(key, { memberLoad, pairHistory });
  }

  const demandOf = (slot: SlotInfo) => ({
    id: slot.id,
    date: slot.date,
    start_time: slot.start_time,
    eligible: matchSlotToMembers(slot).length,
    quota: slot.min_members || 2,
  });

  const orderedSlots = ([...sortedSlots] as SlotInfo[]).sort((a, b) =>
    compareByTension(demandOf(a), demandOf(b)),
  );

  for (const slot of orderedSlots) {
    const { memberLoad, pairHistory } = stateByEpreuve.get(epreuveKeyOf(slot))!;
    const existing = currentBySlot[slot.id] || new Set<string>();
    const slotInfo = slot;

    // 9a. Frozen slots — don't touch
    if (isFrozen(slotInfo)) {
      frozenCount++;
      continue;
    }

    // 9b. Créneaux verrouillés (clôturés OU jury composé à la main) :
    //     on préserve le jury en place, on ne fait que compléter s'il manque
    //     des examinateurs.
    if (isLocked(slotInfo)) {
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
          Array.from(existing).forEach((otherId) => {
            const key = pairKey(id, otherId);
            pairHistory.set(key, (pairHistory.get(key) || 0) + 1);
          });
          added++;
        }
      }
      continue;
    }

    // 9c. Open slots — full re-allocation with brassage + equity.
    //
    // Sélection GLOUTONNE : à chaque pick on re-trie les candidats restants
    // selon (charge + pénalité de binôme vis-à-vis des déjà-choisis). C'est
    // ce qui fait réellement varier les duos — l'ancien tri unique (calculé
    // avant le premier pick) laissait la pénalité de binôme inopérante.
    const quota = slot.min_members || 2;
    const picked: string[] = [];
    const pool = matchSlotToMembers(slotInfo).filter(
      (id) => !wouldConflict(id, slotInfo, memberCommittedSlots),
    );

    while (picked.length < quota && pool.length > 0) {
      pool.sort(
        (a, b) =>
          scoreMember(a, picked, memberLoad, pairHistory) -
          scoreMember(b, picked, memberLoad, pairHistory),
      );
      const chosen = pool.shift()!;
      picked.push(chosen);
      commitMember(chosen, slotInfo, memberLoad, memberCommittedSlots);
      for (const other of picked.slice(0, -1)) {
        const key = pairKey(chosen, other);
        pairHistory.set(key, (pairHistory.get(key) || 0) + 1);
      }
    }

    picked.forEach((memberId) => {
      assignmentsToInsert.push({ slot_id: slot.id, member_id: memberId });
    });

    // 9d. Remplaçants (liste d'attente).
    //
    // Deux populations, dans cet ordre :
    //   1. Les examinateurs LIBRES à cet horaire — les vrais remplaçants,
    //      plafonnés à BACKUP_COUNT.
    //   2. Les « perdants de l'arbitrage » : ceux qui s'étaient inscrits sur ce
    //      créneau MAIS que le dispatch a placés sur une épreuve qui le
    //      chevauche. Ils restent sur la liste d'attente (sans plafond : ce
    //      sont exactement les gens qui avaient coché les deux épreuves) pour
    //      pouvoir être promus si quelqu'un se désiste ailleurs. La promotion
    //      (toggle-member) revérifie le conflit horaire au moment de promouvoir,
    //      donc en inscrire un ici ne risque pas de le placer à deux endroits.
    const remainingEligible = matchSlotToMembers(slotInfo).filter(
      (id) => !picked.includes(id),
    );
    const byScore = (a: string, b: string) =>
      scoreMember(a, picked, memberLoad, pairHistory) -
      scoreMember(b, picked, memberLoad, pairHistory);

    const freeBackups = remainingEligible
      .filter((id) => !wouldConflict(id, slotInfo, memberCommittedSlots))
      .sort(byScore)
      .slice(0, BACKUP_COUNT);
    // Don't increment load for backups — they're on standby

    const conflictedBackups = remainingEligible
      .filter((id) => wouldConflict(id, slotInfo, memberCommittedSlots))
      .sort(byScore);

    const backups = [...freeBackups, ...conflictedBackups];

    backups.forEach((memberId) => {
      backupAssignments.push({ slot_id: slot.id, member_id: memberId });
    });
    conflictedBackups.forEach((memberId) => {
      arbitrationLosers.push({ slot_id: slot.id, member_id: memberId });
    });

    // 9e. Track unfilled slots
    if (picked.length < quota) {
      unfilled.push({
        slot_id: slot.id,
        needed: quota,
        got: picked.length,
      });
    }

    // 9f. Detect members previously assigned but not anymore (equity removal)
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
  // 10. Write assignments to DB — ATOMIQUE.
  // delete (créneaux non gelés / non clôturés) + insert des titulaires se font
  // dans UNE seule transaction Postgres via la RPC replace_slot_assignments :
  // si l'insert échoue, le delete est annulé → un créneau n'est jamais laissé
  // sans jury. Repli non atomique tant que la RPC n'est pas déployée. Une vraie
  // erreur est propagée (rien n'a changé) pour ne pas mettre à jour des statuts
  // désynchronisés à l'étape 11. Cf. dispatch-io.ts.
  const wipeableSlotIds = sortedSlots
    .filter((s: any) => !isLocked(s as SlotInfo) && !isFrozen(s as SlotInfo))
    .map((s: any) => s.id);

  await applyAssignments(
    supabaseAdmin as unknown as DispatchClient,
    wipeableSlotIds,
    assignmentsToInsert,
  );

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

  // 10bis. LISTE D'ATTENTE — les « perdants de l'arbitrage ».
  //
  // Un examinateur qui s'était inscrit sur deux épreuves au même moment n'a pu
  // être placé que sur une seule. Sur l'autre créneau, on l'inscrit en liste
  // d'attente (`slot_availability_requests`) : c'est la table que lit la
  // promotion automatique de /api/slots/toggle-member. Si un titulaire se
  // désiste et que l'horaire s'est libéré entre-temps, il peut être promu.
  //
  // `source` distingue ces lignes de celles qu'un membre s'est ajoutées
  // lui-même (bouton « je suis dispo » → source = 'member') : le dispatch ne
  // supprime JAMAIS que les siennes. Tant que la colonne n'existe pas en base,
  // on ne touche à rien du tout (on ne peut pas distinguer les deux).
  if (wipeableSlotIds.length > 0) {
    const cleanup = await supabaseAdmin
      .from("slot_availability_requests")
      .delete()
      .eq("source", "dispatch")
      .in("slot_id", wipeableSlotIds);

    if (cleanup.error) {
      console.warn(
        "[dispatch] Colonne slot_availability_requests.source absente — les " +
          "examinateurs inscrits sur deux épreuves simultanées ne sont PAS " +
          "mis en liste d'attente sur le créneau non retenu. Appliquez la " +
          "section « dispos par épreuve » de MIGRATIONS_A_APPLIQUER.sql.",
      );
    } else if (arbitrationLosers.length > 0) {
      const { error: waitlistErr } = await supabaseAdmin
        .from("slot_availability_requests")
        .upsert(
          arbitrationLosers.map((r) => ({ ...r, source: "dispatch" })),
          { onConflict: "slot_id,member_id", ignoreDuplicates: true },
        );
      if (waitlistErr) {
        console.error("Waitlist (arbitrage) insert error:", waitlistErr);
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
    if (isLocked(slot as SlotInfo) || isFrozen(slot as SlotInfo)) continue;

    const assignedCount = assignmentsToInsert.filter(
      (a) => a.slot_id === slot.id,
    ).length;

    // Épreuve de groupe (business game) : le créneau ne s'ouvre aux
    // candidats qu'une fois le nombre d'examinateurs AU COMPLET (= son
    // minimum, égal au minimum de candidats), pas dès le premier arrivé —
    // voir docs/superpowers/specs/2026-09-07-min-candidats-epreuves-groupe-design.md.
    const requiredForPublish = (slot as any).epreuve?.is_group_epreuve
      ? slot.min_members || 1
      : 1;

    let newStatus: string;
    if (planningVisibleToCandidates && assignedCount >= requiredForPublish) {
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
    // Recompute aggregate stats from the final assignments (memberLoad and
    // pairHistory are now scoped per-épreuve inside the loop).
    const finalLoad: Record<string, number> = {};
    assignmentsToInsert.forEach((a) => {
      finalLoad[a.member_id] = (finalLoad[a.member_id] || 0) + 1;
    });
    const finalPairs: Record<string, number> = {};
    const bySlot: Record<string, string[]> = {};
    assignmentsToInsert.forEach((a) => {
      (bySlot[a.slot_id] ||= []).push(a.member_id);
    });
    Object.values(bySlot).forEach((members) => {
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const key = pairKey(members[i], members[j]);
          finalPairs[key] = (finalPairs[key] || 0) + 1;
        }
      }
    });

    const statsPayload = {
      total_slots: sortedSlots.length,
      assigned: assignmentsToInsert.length,
      backups: backupAssignments.length,
      unfilled: unfilled.length,
      frozen: frozenCount,
      notifications: notificationCount,
      member_load: finalLoad,
      pair_diversity: finalPairs,
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
