/**
 * dispatch-core — Logique PURE de répartition des examinateurs.
 *
 * Aucune dépendance I/O (pas de Supabase) : ces fonctions sont
 * déterministes et testables unitairement (voir dispatch-core.test.ts).
 * dispatchService.ts (effets de bord + DB) s'appuie dessus.
 */

// ─── Constantes ───────────────────────────────────────────────────────
export const FREEZE_HOURS = 24;
export const PAIR_PENALTY_WEIGHT = 2; // Multiplicateur pénalité binôme

// ─── Types ────────────────────────────────────────────────────────────
export interface SlotTiming {
  date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
}

export interface AvailabilityTiming {
  date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Clé canonique d'une paire (triée pour l'unicité). */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/** "HH:MM" depuis une valeur d'heure quelconque. */
function hhmm(v: string | null | undefined): string {
  return String(v || "").substring(0, 5);
}

/** "YYYY-MM-DD" depuis une valeur de date quelconque. */
function ymd(v: string | null | undefined): string {
  return String(v || "").substring(0, 10);
}

/** Vrai si deux intervalles horaires [aStart,aEnd[ et [bStart,bEnd[ se chevauchent. */
export function timeOverlaps(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Une disponibilité couvre-t-elle un créneau ?
 *
 * - Même jour obligatoire.
 * - Si la dispo a une heure de fin → on teste le CHEVAUCHEMENT (une dispo
 *   12h00–13h00 couvre un créneau 12h05–12h50). C'est ce qui évite qu'une
 *   épreuve de groupe se retrouve sous-staffée parce que les heures de début
 *   ne coïncident pas exactement.
 * - Sinon (ancienne donnée sans end_time) → repli sur l'égalité d'heure de
 *   début (comportement historique, rétro-compatible).
 */
export function availabilityMatchesSlot(
  av: AvailabilityTiming,
  slot: SlotTiming,
): boolean {
  if (ymd(av.date) !== ymd(slot.date)) return false;
  const avStart = hhmm(av.start_time);
  const sStart = hhmm(slot.start_time);
  if (!av.end_time) return avStart === sStart;
  const avEnd = hhmm(av.end_time);
  const sEnd = hhmm(slot.end_time) || sStart;
  return timeOverlaps(avStart, avEnd, sStart, sEnd);
}

/** Un créneau est-il gelé (< FREEZE_HOURS avant son début) ? */
export function isFrozen(slot: SlotTiming, now: Date = new Date()): boolean {
  const dateStr = ymd(slot.date);
  const timeStr = hhmm(slot.start_time) || "08:00";
  const slotDate = new Date(`${dateStr}T${timeStr}:00`);
  return slotDate.getTime() - now.getTime() < FREEZE_HOURS * 3600 * 1000;
}

/**
 * Score d'un membre pour un créneau (plus bas = meilleur candidat).
 * Combine la charge (équité) et la pénalité de binôme (brassage).
 */
export function scoreMember(
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
