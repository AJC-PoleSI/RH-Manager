import { supabaseAdmin, isMissingTableError } from "@/lib/supabase";
import {
  pairKey,
  isFrozen,
  scoreMember,
  availabilityMatchesSlot,
  compareByTension,
  epreuveShortfall,
  slotFillTarget,
  roomStreak,
  orderPredecessorsFirst,
  blocksSlot,
  ROOM_STREAK_MAX,
  type SlotContinuity,
} from "@/lib/dispatch-core";
import { applyAssignments, type DispatchClient } from "@/lib/dispatch-io";
import {
  effectiveMaxCandidates,
  filterActiveEnrollments,
} from "@/lib/enrollment";
import { isEliminated } from "@/lib/favorites";
import { getToursByNumber } from "@/lib/tour-status";

/**
 * Dispatch Service — Algorithme de répartition intelligente des examinateurs.
 *
 * Enrichit le système d'auto-allocate existant avec :
 *   1. Équité (fairness) — priorité absolue aux membres à 0 créneau
 *   2. Brassage (anti-binôme) — pénalise les paires récurrentes
 *   3. Liste d'attente / Backup — 2 remplaçants par créneau
 *   4. Notifications — alerte quand un membre est désinscrit pour équité
 *   5. Gel à 24h — ne touche plus au planning dans les 24h avant l'épreuve
 *   6. Arbitrage des épreuves simultanées — un examinateur peut se déclarer
 *      disponible sur deux épreuves qui se chevauchent ; le dispatch le place
 *      sur celle qui risque le plus de ne PAS pouvoir faire passer tous ses
 *      candidats, et l'inscrit en liste d'attente sur l'autre.
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
  /** Salle physique. Porte la continuité : on évite de déplacer les jurys. */
  room?: string | null;
  status: string;
  min_members: number;
  max_candidates?: number | null;
  epreuve_id: string | null;
  enrollments?: Array<{ id: string; status?: string }>;
  epreuve?: {
    is_group_epreuve?: boolean | null;
    group_size?: number | null;
    is_pole_test?: boolean | null;
    pole?: string | null;
    tour?: number | null;
    roulement_minutes?: number | null;
  } | null;
}

/**
 * Une évaluation ne compte que si elle porte de VRAIES notes : une ligne vide
 * (créée puis abandonnée) ne veut pas dire que le candidat est passé. Même
 * règle que la garde anti-double-évaluation de /api/slots/enroll.
 */
function hasRealScores(raw: unknown): boolean {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") return false;
    const values = Object.values(parsed as Record<string, unknown>);
    return (
      values.length > 0 &&
      values.some((v) => v !== null && v !== undefined && v !== "")
    );
  } catch {
    return false;
  }
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

/** Clé d'épreuve d'un créneau (les créneaux sans épreuve sont regroupés). */
function epreuveKeyOf(slot: SlotInfo): string {
  return slot.epreuve_id || "__sans_epreuve__";
}

/** Engagement horaire d'un examinateur, avec l'épreuve et la salle concernées. */
interface Commitment {
  date: string;
  start: string;
  end: string;
  epreuve: string;
  room: string | null;
  roulementMinutes: number;
}

type CommittedSlots = Record<string, Commitment[]>;

/** Convertit un SlotInfo en engagement horaire (salle + roulement inclus). */
function commitmentOf(slot: SlotInfo): Commitment {
  return {
    date: String(slot.date || "").substring(0, 10),
    start: String(slot.start_time || "").substring(0, 5),
    end: String(slot.end_time || "").substring(0, 5),
    epreuve: epreuveKeyOf(slot),
    room: slot.room ? String(slot.room) : null,
    roulementMinutes: slot.epreuve?.roulement_minutes ?? 0,
  };
}

/**
 * Engagements de ce membre qui BLOQUENT ce créneau : chevauchement horaire
 * strict, ou changement de salle sans le temps de roulement minimum entre les
 * deux (cf. `blocksSlot`, dispatch-core.ts — bug remonté par Felix le
 * 10/09/2026 : un examinateur enchaînait Business Game et entretien
 * individuel dans deux salles différentes à la minute près).
 */
function blockingCommitments(
  memberId: string,
  slot: SlotInfo,
  memberCommittedSlots: CommittedSlots,
): Commitment[] {
  const committed = memberCommittedSlots[memberId] || [];
  const target = commitmentOf(slot);
  return committed.filter((c) => blocksSlot(c, target));
}

/** Check temporal overlap (ou battement insuffisant) between a member's committed slots and a candidate slot */
function wouldConflict(
  memberId: string,
  slot: SlotInfo,
  memberCommittedSlots: CommittedSlots,
): boolean {
  return blockingCommitments(memberId, slot, memberCommittedSlots).length > 0;
}

/**
 * Vrai si le conflit vient d'une AUTRE épreuve — c'est le seul cas où
 * l'examinateur a réellement perdu un arbitrage (il s'était inscrit sur deux
 * épreuves simultanées et n'a pu obtenir que l'une des deux). Deux salles de la
 * MÊME épreuve au même horaire sont interchangeables : ne pas être dans l'une
 * parce qu'on est dans l'autre n'a rien d'un choix subi.
 */
function lostArbitration(
  memberId: string,
  slot: SlotInfo,
  memberCommittedSlots: CommittedSlots,
): boolean {
  const key = epreuveKeyOf(slot);
  return blockingCommitments(memberId, slot, memberCommittedSlots).some(
    (c) => c.epreuve !== key,
  );
}

/** Record a member commitment to a slot for overlap tracking */
function commitMember(
  memberId: string,
  slot: SlotInfo,
  memberLoad: Record<string, number>,
  memberCommittedSlots: CommittedSlots,
): void {
  memberLoad[memberId] = (memberLoad[memberId] || 0) + 1;
  if (!memberCommittedSlots[memberId]) memberCommittedSlots[memberId] = [];
  memberCommittedSlots[memberId].push(commitmentOf(slot));
}

// ─── Main Dispatch Function ───────────────────────────────────────────

export async function runDispatch(opts?: {
  epreuveId?: string;
}): Promise<DispatchResult> {
  // 1. Fetch slots with enrollments
  //
  // PAGINÉ — obligatoire. PostgREST plafonne toute réponse à 1000 lignes, sans
  // erreur ni avertissement. Au 11/09/2026 la base comptait 1076 créneaux et
  // 1189 affectations : le dispatch n'en voyait donc que 1000 de chaque, dans
  // un ordre arbitraire faute de `.order()`. Les changements de disponibilité
  // portant sur les 76 créneaux invisibles n'étaient JAMAIS appliqués — le
  // planning restait figé sans le moindre signal. C'est le bug rapporté par
  // Felix (« l'algorithme n'a pas pris en compte les nouvelles dispos »).
  //
  // L'ordre sur `id` n'a pas de sens métier — le tri chronologique se fait en
  // mémoire, étape 6 — il ne sert qu'à rendre la pagination déterministe.
  const { data: slots, error: slotErr } = await fetchAllRows<any>((from, to) => {
    let q = supabaseAdmin
      .from("evaluation_slots")
      .select(
        "id, date, start_time, end_time, room, status, min_members, max_candidates, epreuve_id, enrollments:slot_enrollments(id, status), epreuve:epreuves(is_group_epreuve, group_size, is_pole_test, pole, tour, roulement_minutes)",
      );
    if (opts?.epreuveId) q = q.eq("epreuve_id", opts.epreuveId);
    return q.order("id").range(from, to);
  });
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
    const withEpreuve = await fetchAllRows<any>((from, to) =>
      supabaseAdmin
        .from("availabilities")
        .select("member_id, date, start_time, end_time, epreuve_id")
        .order("id")
        .range(from, to),
    );

    if (withEpreuve.error) {
      const plain = await fetchAllRows<any>((from, to) =>
        supabaseAdmin
          .from("availabilities")
          .select("member_id, date, start_time, end_time")
          .order("id")
          .range(from, to),
      );
      if (plain.error) throw plain.error;
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
  //
  // BUG (rapporté par Felix le 10/09/2026, plusieurs cas observés le lundi) :
  // un dispatch scoped à une épreuve (`opts.epreuveId`, cas du bouton
  // "Publier" par épreuve) ne charge dans `slots` QUE les créneaux de cette
  // épreuve. Si on se contente de lire les affectations `.in("slot_id",
  // slotIds)`, les affectations des AUTRES épreuves — posées par un run
  // précédent, scoped sur une épreuve différente — restent invisibles :
  // registerConflict (étape 8) ne les enregistre jamais, et ce run peut donc
  // réaffecter librement un examinateur déjà engagé au même horaire sur une
  // autre épreuve. Résultat vécu : le même examinateur inscrit sur deux
  // créneaux qui se chevauchent le même jour.
  //
  // Fix : on lit TOUJOURS les affectations de TOUS les créneaux (pas
  // seulement `slotIds`), avec l'horaire de leur créneau. Celles hors du lot
  // traité par ce run sont enregistrées plus bas comme engagements fixes
  // (étape 8bis), quel que soit leur statut gelé/verrouillé — ce run ne les
  // recalcule de toute façon jamais.
  //
  // On lit aussi `is_manual` : un examinateur placé À LA MAIN par l'admin
  // (toggle-member) épingle son créneau, que le dispatch ne doit plus
  // rebrasser. Tant que la colonne n'est pas posée en base, on retombe sur la
  // lecture d'origine et le comportement reste celui d'avant.
  const slotIds = slots.map((s: any) => s.id);
  const slotIdSet = new Set(slotIds);
  let allAssigns: any[] | null = null;
  {
    const withManual = await fetchAllRows<any>((from, to) =>
      supabaseAdmin
        .from("slot_member_assignments")
        .select(
          "slot_id, member_id, is_manual, slot:evaluation_slots(date, start_time, end_time, epreuve_id, room, epreuve:epreuves(roulement_minutes))",
        )
        .order("slot_id")
        .range(from, to),
    );

    if (withManual.error) {
      const plain = await fetchAllRows<any>((from, to) =>
        supabaseAdmin
          .from("slot_member_assignments")
          .select(
            "slot_id, member_id, slot:evaluation_slots(date, start_time, end_time, epreuve_id, room, epreuve:epreuves(roulement_minutes))",
          )
          .order("slot_id")
          .range(from, to),
      );
      if (plain.error) throw plain.error;
      allAssigns = plain.data;
      console.warn(
        "[dispatch] Colonne slot_member_assignments.is_manual absente — les " +
          "affectations manuelles ne sont PAS protégées du rebrassage. " +
          "Appliquez la section « dispatch : affectations manuelles » de " +
          "MIGRATIONS_A_APPLIQUER.sql.",
      );
    } else {
      allAssigns = withManual.data;
    }
  }

  const currentAssigns = (allAssigns || []).filter((a: any) =>
    slotIdSet.has(a.slot_id),
  );
  // Affectations sur des créneaux HORS du lot traité par ce run (autre
  // épreuve quand `opts.epreuveId` est fourni) — engagements fixes, cf. étape 8bis.
  const externalAssigns = (allAssigns || []).filter(
    (a: any) => !slotIdSet.has(a.slot_id) && a.slot,
  );

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

  // 6bis. Chaînes de salle — continuité des jurys.
  //
  // Un examinateur doit rester dans la MÊME salle avec le MÊME binôme sur des
  // créneaux qui se suivent (jusqu'à ROOM_STREAK_MAX), sans quoi il change de
  // salle et de partenaire à chaque passage : déplacement + re-calibrage entre
  // examinateurs = temps perdu. Cf. la spec
  // docs/superpowers/specs/2026-09-08-dispatch-continuite-salle-design.md
  //
  // La chaîne est indexée par (jour, salle), TOUTES ÉPREUVES CONFONDUES :
  // rester sur place est un gain de temps physique, même si deux épreuves
  // différentes s'enchaînent dans la même salle. Une pause entre deux créneaux
  // ne rompt pas la chaîne — la personne ne bouge pas pour autant.
  const chainOf = new Map<string, { chain: string[]; index: number }>();
  const predecessorOf = new Map<string, string>();
  {
    const chains = new Map<string, string[]>();
    (sortedSlots as SlotInfo[]).forEach((s) => {
      const room = String(s.room || "").trim();
      if (!room) return; // sans salle identifiée, pas de continuité physique
      const key = `${String(s.date).substring(0, 10)}|${room}`;
      if (!chains.has(key)) chains.set(key, []);
      chains.get(key)!.push(s.id);
    });
    // sortedSlots est déjà chronologique → chaque chaîne l'est aussi.
    chains.forEach((chain) => {
      chain.forEach((slotId, index) => {
        chainOf.set(slotId, { chain, index });
        if (index > 0) predecessorOf.set(slotId, chain[index - 1]);
      });
    });
  }

  // Affectations connues par créneau : l'état d'AVANT le run, écrasé au fur et
  // à mesure des décisions. Comme un créneau n'est jamais servi avant son
  // prédécesseur de salle (cf. orderPredecessorsFirst), lire le prédécesseur
  // renvoie toujours une décision fraîche — ou le jury figé d'un créneau gelé
  // ou verrouillé, qui doit précisément servir d'ancre.
  const membersBySlot = new Map<string, Set<string>>();
  Object.entries(currentBySlot).forEach(([slotId, members]) => {
    membersBySlot.set(slotId, new Set(members));
  });

  /**
   * Membres à garder sur place sur ce créneau : ceux du créneau précédent de
   * la même salle dont le streak n'a pas atteint le plafond.
   */
  const continuingMembersOf = (slotId: string): Set<string> => {
    const entry = chainOf.get(slotId);
    const continuing = new Set<string>();
    if (!entry || entry.index === 0) return continuing;
    const previous = membersBySlot.get(entry.chain[entry.index - 1]);
    previous?.forEach((memberId) => {
      if (
        roomStreak(memberId, entry.chain, entry.index, membersBySlot) <
        ROOM_STREAK_MAX
      ) {
        continuing.add(memberId);
      }
    });
    return continuing;
  };

  /**
   * Ce créneau prolonge-t-il une salle déjà occupée ? (cf. `continuesChain`)
   *
   * Lu au moment du TRI, donc sur l'état d'avant le run : c'est exactement ce
   * qu'il faut pour savoir quelle salle a une équipe en place à préserver.
   */
  const chainHasOccupiedPredecessor = (slotId: string): boolean => {
    const entry = chainOf.get(slotId);
    if (!entry || entry.index === 0) return false;
    return (membersBySlot.get(entry.chain[entry.index - 1])?.size || 0) > 0;
  };

  // Créneaux du même jour — support du calcul d'arrachement ci-dessous.
  const slotsByDate = new Map<string, SlotInfo[]>();
  (sortedSlots as SlotInfo[]).forEach((s) => {
    const key = String(s.date).substring(0, 10);
    if (!slotsByDate.has(key)) slotsByDate.set(key, []);
    slotsByDate.get(key)!.push(s);
  });

  /**
   * Qui déloger‑t‑on en pourvoyant ce créneau ? (cf. UPROOT_PENALTY)
   *
   * Un membre est « arraché » si une AUTRE salle a, à un horaire incompatible
   * avec celui-ci, un créneau qui prolongerait sa chaîne en cours. Le prendre
   * ici lui coûte sa continuité — et laisse potentiellement sa salle vide.
   *
   * Le malus ne fait qu'ordonner le vivier : si ce membre est le seul
   * disponible, il est pris quand même (cf. la boucle gloutonne, étape 9c).
   */
  const uprootedBy = (slot: SlotInfo): Set<string> => {
    const uprooting = new Set<string>();
    const target = commitmentOf(slot);
    if (!target.room) return uprooting;

    for (const other of slotsByDate.get(target.date) || []) {
      if (other.id === slot.id) continue;
      const otherCommitment = commitmentOf(other);
      if (!otherCommitment.room || otherCommitment.room === target.room)
        continue;
      // Prendre ce créneau empêche-t-il de tenir l'autre ?
      if (!blocksSlot(otherCommitment, target)) continue;
      continuingMembersOf(other.id).forEach((memberId) =>
        uprooting.add(memberId),
      );
    }
    return uprooting;
  };

  /** Qui garder sur place sur ce créneau, et qui y était déjà avant le run. */
  const continuityFor = (slot: SlotInfo): SlotContinuity => ({
    continuing: continuingMembersOf(slot.id),
    anchored: currentBySlot[slot.id],
    uprooting: uprootedBy(slot),
  });

  // 7. Tracking structures
  //
  // memberCommittedSlots est GLOBAL (toutes épreuves confondues) : il sert à
  // empêcher le double-booking temporel — un examinateur ne peut pas être sur
  // deux créneaux qui se chevauchent, même s'ils relèvent d'épreuves
  // différentes.
  const memberCommittedSlots: CommittedSlots = {};

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
    memberCommittedSlots[memberId].push(commitmentOf(slot));
  };
  for (const slot of sortedSlots) {
    if (isFrozen(slot as SlotInfo) || isLocked(slot as SlotInfo)) {
      const existing = currentBySlot[slot.id] || new Set<string>();
      existing.forEach((memberId) => registerConflict(memberId, slot as SlotInfo));
    }
  }

  // 8bis. Affectations sur des créneaux HORS du lot traité par ce run (autre
  // épreuve, cf. `externalAssigns` étape 3) : ce run ne les recalcule jamais,
  // donc elles comptent TOUJOURS comme engagement fixe — peu importe qu'elles
  // soient gelées ou non. Sans ça, un dispatch scoped-épreuve peut réaffecter
  // un examinateur déjà engagé au même horaire sur une épreuve qu'il ne
  // traite pas (cf. commentaire étape 3).
  externalAssigns.forEach((a: any) => {
    if (a.member_id && a.slot) registerConflict(a.member_id, a.slot as SlotInfo);
  });

  // 9. Allocation : charge GLOBALE, brassage PAR ÉPREUVE, ordre GLOBAL.
  //
  // La charge (équité) se compte sur le total des créneaux, toutes épreuves
  // confondues ; le brassage des binômes reste interne à chaque épreuve.
  //
  // En revanche l'ORDRE dans lequel les créneaux se servent est GLOBAL et suit
  // leur TENSION (examinateurs disponibles − quota) : le créneau qui manque le
  // plus d'examinateurs choisit en premier. C'est ce qui tranche le cas « un
  // examinateur s'est inscrit sur deux épreuves qui se chevauchent » : il est
  // placé là où il manque vraiment, et reste remplaçant sur l'autre (étape 9d).
  const slotsByEpreuve = new Map<string, SlotInfo[]>();
  for (const slot of sortedSlots) {
    const key = epreuveKeyOf(slot as SlotInfo);
    if (!slotsByEpreuve.has(key)) slotsByEpreuve.set(key, []);
    slotsByEpreuve.get(key)!.push(slot as SlotInfo);
  }

  // CHARGE (équité) : GLOBALE, toutes épreuves confondues.
  //
  // Elle était calculée par épreuve, ce qui remettait chacun à zéro d'une
  // épreuve à l'autre : quelqu'un déjà très sollicité sur les business games
  // repartait « vierge » aux yeux des entretiens individuels. Constat sur les
  // données réelles du 11/09/2026 : Emilie Munsch 1re sur Business Game (22
  // créneaux) et avant-dernière sur Entretien individuel (7). Un examinateur
  // qui donne une matinée la donne, quelle que soit l'épreuve — c'est bien le
  // total qui doit être équilibré.
  //
  // BRASSAGE (binômes) : reste PAR ÉPREUVE. Un jury de business game réunit 6
  // personnes, un entretien 2 : mélanger les deux fausserait la pénalité de
  // binôme, et chaque épreuve doit garder sa propre rotation.
  const memberLoad: Record<string, number> = {};
  for (const slot of sortedSlots) {
    if (isFrozen(slot as SlotInfo) || isLocked(slot as SlotInfo)) {
      const existing = currentBySlot[slot.id] || new Set<string>();
      existing.forEach((memberId) => {
        memberLoad[memberId] = (memberLoad[memberId] || 0) + 1;
      });
    }
  }

  const stateByEpreuve = new Map<
    string,
    { memberLoad: Record<string, number>; pairHistory: Map<string, number> }
  >();
  for (const key of Array.from(slotsByEpreuve.keys())) {
    stateByEpreuve.set(key, { memberLoad, pairHistory: new Map() });
  }

  // ── PRÉVISION PAR ÉPREUVE : pourra-t-on faire passer tout le monde ? ──
  //
  // Le critère métier n'est pas « ce créneau a-t-il ses 2 examinateurs » mais
  // « cette épreuve pourra-t-elle faire passer tous ses candidats ». Exemple
  // vécu : un business game dont il manque des examinateurs laisserait 20
  // candidats sur le carreau, alors que les entretiens individuels ont déjà
  // largement assez de créneaux dotés. Le business game doit donc se servir en
  // premier — c'est ce que calcule ce bloc, consommé par compareByTension.
  //
  //   demande  = candidats qui doivent ENCORE passer cette épreuve, c'est-à-dire
  //              ceux qui sont admis au tour de l'épreuve, qui n'ont pas encore
  //              de note dessus, et (épreuve de pôle) qui ont demandé ce pôle
  //   capacité = places offertes par les créneaux qu'on peut RÉELLEMENT doter
  //              (un créneau sans assez d'examinateurs disponibles ne compte
  //              pas : il ne pourra pas se tenir)
  //
  // PORTÉE PAR TOUR — indispensable : seules les épreuves du tour EN COURS ont
  // une demande. Sans ce garde-fou, tant que les délibérations du tour 1 ne sont
  // pas saisies, personne n'est encore éliminé : une épreuve de pôle du tour 3
  // afficherait « 200 candidats à faire passer pour 40 places » et raflerait les
  // examinateurs des entretiens du tour 1, qui eux ont lieu aujourd'hui. Une
  // épreuve hors tour en cours garde une demande nulle : elle est servie en
  // dernier, sans jamais bloquer le tour en cours.
  //
  // En cas d'échec de lecture, les deux Maps restent vides : l'ordonnancement
  // retombe alors sur la tension par créneau, comme avant.
  const epreuveDemandById = new Map<string, number>();
  const epreuveCapacityById = new Map<string, number>();

  /** Places candidats réellement exploitables sur un créneau (0 si non dotable). */
  const staffableCapacity = (slot: SlotInfo): number => {
    // Créneau clôturé : l'épreuve est passée, ses candidats sont déjà sortis
    // de la demande — ne pas les recompter comme capacité disponible.
    if (slot.status === "closed") return 0;
    const quota = slot.min_members || 2;
    const current = (currentBySlot[slot.id] || new Set<string>()).size;
    // Un créneau gelé ne peut plus être complété : seul son jury actuel compte.
    const potential = isFrozen(slot)
      ? current
      : Math.max(current, matchSlotToMembers(slot).length);
    return potential >= quota ? effectiveMaxCandidates(slot) : 0;
  };

  try {
    const epreuveIds = Array.from(
      new Set(
        (slots as any[]).map((s) => s.epreuve_id).filter(Boolean) as string[],
      ),
    );

    if (epreuveIds.length > 0) {
      const [candRes, delibRes, wishRes, evalRes, toursByNumber] =
        await Promise.all([
          supabaseAdmin.from("candidates").select("id"),
          supabaseAdmin
            .from("deliberations")
            .select("candidate_id, tour1_status, tour2_status, tour3_status"),
          supabaseAdmin.from("candidate_wishes").select("candidate_id, pole"),
          supabaseAdmin
            .from("candidate_evaluations")
            .select("candidate_id, epreuve_id, scores")
            .in("epreuve_id", epreuveIds),
          getToursByNumber(),
        ]);

      // Candidats éliminés : plus aucune épreuve à leur faire passer.
      const eliminated = new Set<string>();
      const delibByCandidate = new Map<string, any>();
      (delibRes.data || []).forEach((d: any) => {
        delibByCandidate.set(d.candidate_id, d);
        if (isEliminated(d)) eliminated.add(d.candidate_id);
      });

      /**
       * Un candidat est attendu au tour N s'il a été ACCEPTÉ au tour N-1.
       * Au tour 1, tout le monde est attendu (sauf refus déjà prononcé).
       */
      const isExpectedAtTour = (candidateId: string, tour: number): boolean => {
        if (tour <= 1) return true;
        const delib = delibByCandidate.get(candidateId);
        return delib?.[`tour${tour - 1}_status`] === "accepted";
      };

      const polesByCandidate = new Map<string, Set<string>>();
      (wishRes.data || []).forEach((w: any) => {
        if (!w.candidate_id || !w.pole) return;
        if (!polesByCandidate.has(w.candidate_id)) {
          polesByCandidate.set(w.candidate_id, new Set());
        }
        polesByCandidate.get(w.candidate_id)!.add(w.pole);
      });

      // Déjà passés (notes réelles) → hors demande.
      const alreadyEvaluated = new Set<string>(); // `${epreuveId}|${candidateId}`
      (evalRes.data || []).forEach((row: any) => {
        if (!hasRealScores(row.scores)) return;
        alreadyEvaluated.add(`${row.epreuve_id}|${row.candidate_id}`);
      });

      const activeCandidates = (candRes.data || [])
        .map((c: any) => c.id as string)
        .filter((id: string) => !eliminated.has(id));

      const epreuveMeta = new Map<string, any>();
      (slots as any[]).forEach((s) => {
        if (s.epreuve_id && !epreuveMeta.has(s.epreuve_id)) {
          epreuveMeta.set(s.epreuve_id, s.epreuve || {});
        }
      });

      for (const epId of epreuveIds) {
        const meta = epreuveMeta.get(epId) || {};
        const tour = Number(meta.tour) || 0;

        // Hors tour en cours → aucune demande (cf. PORTÉE PAR TOUR ci-dessus).
        // Si la table `tours` n'est pas renseignée, aucune épreuve n'est
        // prioritaire et l'ordonnancement retombe sur la tension par créneau.
        if (!tour || toursByNumber[tour]?.status !== "en_cours") {
          epreuveDemandById.set(epId, 0);
          continue;
        }

        let demand = 0;
        for (const candidateId of activeCandidates) {
          if (!isExpectedAtTour(candidateId, tour)) continue;
          if (alreadyEvaluated.has(`${epId}|${candidateId}`)) continue;
          // Épreuve de pôle : seuls les candidats qui ont demandé ce pôle.
          if (meta.is_pole_test && meta.pole) {
            const poles = polesByCandidate.get(candidateId);
            if (!poles || !poles.has(meta.pole)) continue;
          }
          demand++;
        }
        epreuveDemandById.set(epId, demand);
      }

      for (const slot of slots as SlotInfo[]) {
        if (!slot.epreuve_id) continue;
        epreuveCapacityById.set(
          slot.epreuve_id,
          (epreuveCapacityById.get(slot.epreuve_id) || 0) +
            staffableCapacity(slot),
        );
      }
    }
  } catch (e) {
    console.error(
      "[dispatch] Prévision par épreuve indisponible — repli sur la tension par créneau:",
      e,
    );
  }

  const demandOf = (slot: SlotInfo) => {
    const epId = slot.epreuve_id || "";
    const demand = epreuveDemandById.get(epId);
    const capacity = epreuveCapacityById.get(epId);
    const shortfall =
      demand === undefined || capacity === undefined
        ? undefined
        : epreuveShortfall(demand, capacity);
    return {
      id: slot.id,
      date: slot.date,
      start_time: slot.start_time,
      eligible: matchSlotToMembers(slot).length,
      quota: slot.min_members || 2,
      epreuveDeficit: shortfall?.deficit,
      epreuveCoverage: shortfall?.coverage,
      isGroupEpreuve: slot.epreuve?.is_group_epreuve ?? false,
      hasEnrolledCandidates: (slot.enrollments || []).some(
        filterActiveEnrollments,
      ),
      continuesChain: chainHasOccupiedPredecessor(slot.id),
    };
  };

  // Précalcul : le comparateur est appelé O(n log n) fois, pas la prévision.
  const demandBySlot = new Map<string, ReturnType<typeof demandOf>>();
  (sortedSlots as SlotInfo[]).forEach((s) => demandBySlot.set(s.id, demandOf(s)));

  // Ordre de tension, PUIS remontée des prédécesseurs de salle : on ne peut pas
  // décider qui garder sur place tant que le créneau précédent de la salle n'est
  // pas tranché. L'arbitrage entre épreuves simultanées est préservé — seuls les
  // prédécesseurs remontent.
  const orderedSlots = orderPredecessorsFirst(
    ([...sortedSlots] as SlotInfo[]).sort((a, b) =>
      compareByTension(demandBySlot.get(a.id)!, demandBySlot.get(b.id)!),
    ),
    predecessorOf,
  );

  for (const slot of orderedSlots) {
    const { memberLoad, pairHistory } = stateByEpreuve.get(epreuveKeyOf(slot))!;
    const existing = currentBySlot[slot.id] || new Set<string>();
    const slotInfo = slot;
    // Qui garder sur place dans cette salle (cf. étape 6bis).
    const continuity = continuityFor(slot);

    // 9a. Frozen slots — don't touch
    if (isFrozen(slotInfo)) {
      frozenCount++;
      // Le jury gelé reste l'ancre du créneau suivant de la salle : on laisse
      // membersBySlot sur l'état en base, qui est précisément ce jury.
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
            score: scoreMember(
              id,
              Array.from(existing),
              memberLoad,
              pairHistory,
              continuity,
            ),
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
          // Le complément fait partie du jury : il compte pour la chaîne.
          // (membersBySlot contient des copies — muter n'affecte pas
          // currentBySlot, qui sert d'ancre inter-run.)
          const chainMembers = membersBySlot.get(slot.id) || new Set<string>();
          chainMembers.add(id);
          membersBySlot.set(slot.id, chainMembers);
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
    //
    // Pour une épreuve de groupe, la cible n'est pas figée au minimum : elle
    // monte avec le vivier réellement libre à cet instant, jusqu'au plafond
    // group_size (cf. slotFillTarget). La boucle s'arrête d'elle-même quand
    // le vivier est épuisé — inutile de plafonner ici par avance.
    const quota = slotFillTarget(
      slot.min_members || 2,
      slot.epreuve?.is_group_epreuve,
      slot.epreuve?.group_size,
    );
    const picked: string[] = [];
    const pool = matchSlotToMembers(slotInfo).filter(
      (id) => !wouldConflict(id, slotInfo, memberCommittedSlots),
    );

    while (picked.length < quota && pool.length > 0) {
      pool.sort(
        (a, b) =>
          scoreMember(a, picked, memberLoad, pairHistory, continuity) -
          scoreMember(b, picked, memberLoad, pairHistory, continuity),
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
    // Décision fraîche : elle remplace l'état d'avant le run et devient l'ancre
    // du créneau suivant de la salle.
    membersBySlot.set(slot.id, new Set(picked));

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
      scoreMember(a, picked, memberLoad, pairHistory, continuity) -
      scoreMember(b, picked, memberLoad, pairHistory, continuity);

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
    conflictedBackups
      .filter((memberId) =>
        lostArbitration(memberId, slotInfo, memberCommittedSlots),
      )
      .forEach((memberId) => {
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

    const slotById = new Map(sortedSlots.map((s: any) => [s.id, s]));
    const backupRows = backupAssignments
      .map((ba, idx) => {
        const slot = slotById.get(ba.slot_id);
        return {
          epreuve_id: (slot as any)?.epreuve_id || null,
          member_id: ba.member_id,
          slot_id: ba.slot_id,
          rang_priorite: idx + 1,
          score_priorite: 0,
          statut: "en_attente",
        };
      })
      .filter((row) => row.epreuve_id);

    // Un seul aller-retour réseau pour tous les remplaçants (au lieu d'un par
    // ligne) : avec ~1100 créneaux ouverts en prod, l'ancienne boucle
    // séquentielle multipliait les latences réseau et rendait chaque
    // enregistrement de dispo perceptiblement bloqué côté examinateur.
    if (backupRows.length > 0) {
      const { error } = await supabaseAdmin
        .from("evaluator_allocations")
        .upsert(backupRows, { onConflict: "slot_id,member_id" });
      if (error && error.code !== "23505") {
        if (isMissingTableError(error)) {
          // Migration supabase-migration-allocation.sql pas encore posée :
          // la table n'existe pas. Un repli ligne par ligne échouerait sur
          // CHAQUE ligne pour la même raison — avec ~1100 créneaux ouverts,
          // c'est exactement ce qui a fait dépasser les 300s de timeout
          // Vercel sur /api/availability en prod. On log une fois et on
          // passe : les remplaçants ne sont pas persistés tant que la
          // migration n'est pas appliquée, mais la dispo elle-même est déjà
          // enregistrée (étape précédente) et le dispatch continue.
          console.warn(
            "[dispatch] Table evaluator_allocations absente — remplaçants non enregistrés. Appliquez supabase-migration-allocation.sql.",
          );
        } else {
          console.error(
            "Backup allocation bulk upsert error, repli ligne par ligne:",
            error,
          );
          for (const row of backupRows) {
            try {
              await supabaseAdmin
                .from("evaluator_allocations")
                .upsert(row, { onConflict: "slot_id,member_id" });
            } catch (e: any) {
              if (e?.code !== "23505") {
                console.error("Backup allocation insert error:", e);
              }
            }
          }
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

  // Un aller-retour réseau par salle (regroupé par statut cible) plutôt qu'un
  // par créneau : même raison que le repli plus haut sur les remplaçants —
  // avec ~1100 créneaux, la boucle séquentielle d'origine dominait le temps
  // de réponse de chaque enregistrement de dispo.
  const assignedCountBySlot = new Map<string, number>();
  assignmentsToInsert.forEach((a) => {
    assignedCountBySlot.set(a.slot_id, (assignedCountBySlot.get(a.slot_id) || 0) + 1);
  });
  const idsByNewStatus = new Map<string, string[]>();
  for (const slot of sortedSlots) {
    if (isLocked(slot as SlotInfo) || isFrozen(slot as SlotInfo)) continue;

    const assignedCount = assignedCountBySlot.get(slot.id) || 0;

    // Le créneau ne s'ouvre aux candidats qu'une fois le nombre
    // d'examinateurs AU COMPLET (= son minimum), pas dès le premier arrivé.
    const requiredForPublish = slot.min_members || 2;

    let newStatus: string;
    if (planningVisibleToCandidates && assignedCount >= requiredForPublish) {
      newStatus = "published";
    } else if (assignedCount >= (slot.min_members || 2)) {
      newStatus = "ready";
    } else {
      newStatus = "open";
    }

    if (slot.status !== newStatus) {
      const ids = idsByNewStatus.get(newStatus) || [];
      ids.push(slot.id);
      idsByNewStatus.set(newStatus, ids);
    }
  }
  for (const [newStatus, ids] of Array.from(idsByNewStatus.entries())) {
    await supabaseAdmin
      .from("evaluation_slots")
      .update({ status: newStatus })
      .in("id", ids);
  }

  // 12. Send notifications for removed members
  // Un seul insert en masse (même raison qu'aux étapes 10 et 11 : éviter un
  // aller-retour réseau par notification quand le rééquilibrage global
  // touche beaucoup de monde en une fois).
  let notificationCount = 0;
  const notificationRows = removedMembers.map((removal) => {
    const dateStr = String(removal.slot.date || "").substring(0, 10);
    const startStr = String(removal.slot.start_time || "").substring(0, 5);
    const dateObj = new Date(`${dateStr}T12:00:00`);
    const dateDisplay = dateObj.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    return {
      member_id: removal.member_id,
      type: "dispatch_change",
      title: "Changement d'affectation",
      body: `Vous avez été retiré du créneau de ${startStr} le ${dateDisplay} (raison : ${removal.reason}). Un autre examinateur a été prioritairement affecté pour garantir l'équité de répartition.`,
      link: "/dashboard",
    };
  });
  if (notificationRows.length > 0) {
    try {
      const { error } = await supabaseAdmin
        .from("notifications")
        .insert(notificationRows);
      if (error) throw error;
      notificationCount = notificationRows.length;
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
