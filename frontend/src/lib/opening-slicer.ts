// Découpage d'une ouverture de salle en créneaux + diff de recalcul.
// Fonctions pures, sans import — testées dans opening-slicer.test.ts.
// Spec : docs/superpowers/specs/2026-07-07-creation-creneaux-ouvertures-design.md

export interface OpeningTimes {
  startTime: string; // "HH:MM"
  endTime: string;
  breakStart?: string | null;
  breakEnd?: string | null;
}

export interface SliceParams {
  durationMinutes: number;
  roulementMinutes: number;
}

export interface SlotTime {
  startTime: string;
  endTime: string;
}

export interface ExistingSlot {
  id: string;
  date: string; // "YYYY-MM-DD" ou ISO
  start_time: string;
  end_time: string;
  occupied: boolean;
}

export interface OpeningDiff {
  toCreate: SlotTime[];
  toDeleteIds: string[];
  keptIds: string[];
  conflictIds: string[];
}

function t2m(t: string): number {
  const [h, m] = String(t).slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function m2t(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/**
 * Découpe une plage en créneaux de `durationMinutes`, espacés de
 * durée + roulement (début à début). Un créneau qui chevauche la pause
 * est décalé au premier horaire après la pause. Le dernier créneau
 * finit au plus tard à endTime. Déterministe.
 */
export function sliceOpening(o: OpeningTimes, p: SliceParams): SlotTime[] {
  const dur = p.durationMinutes;
  const spacing = dur + p.roulementMinutes;
  if (dur <= 0 || spacing <= 0) return [];
  const end = t2m(o.endTime);
  const bs = o.breakStart ? t2m(o.breakStart) : null;
  const be = o.breakEnd ? t2m(o.breakEnd) : null;
  const hasBreak = bs !== null && be !== null && be > bs;

  const out: SlotTime[] = [];
  let cur = t2m(o.startTime);
  while (cur + dur <= end) {
    if (hasBreak && cur < (be as number) && (bs as number) < cur + dur) {
      cur = be as number; // saute la pause
      continue;
    }
    out.push({ startTime: m2t(cur), endTime: m2t(cur + dur) });
    cur += spacing;
  }
  return out;
}

const slotKey = (d: string, s: string, e: string) =>
  `${String(d).split("T")[0]}|${String(s).slice(0, 5)}|${String(e).slice(0, 5)}`;

/**
 * Diff entre le découpage cible (nouvelle ouverture) et les créneaux
 * existants liés à l'ouverture :
 *   libre + match  → conservé
 *   libre hors cible → supprimé
 *   occupé + match → conservé (jamais touché)
 *   occupé hors cible → conflit (jamais supprimé automatiquement)
 *   horaire cible sans créneau → créé
 */
export function diffOpeningSlots(
  targetDate: string,
  target: SlotTime[],
  existing: ExistingSlot[],
): OpeningDiff {
  const targetKeys = new Set(
    target.map((t) => slotKey(targetDate, t.startTime, t.endTime)),
  );
  const covered = new Set<string>();
  const toDeleteIds: string[] = [];
  const keptIds: string[] = [];
  const conflictIds: string[] = [];

  for (const s of existing) {
    const k = slotKey(s.date, s.start_time, s.end_time);
    if (targetKeys.has(k)) {
      covered.add(k);
      keptIds.push(s.id);
    } else if (s.occupied) {
      conflictIds.push(s.id);
    } else {
      toDeleteIds.push(s.id);
    }
  }

  const toCreate = target.filter(
    (t) => !covered.has(slotKey(targetDate, t.startTime, t.endTime)),
  );
  return { toCreate, toDeleteIds, keptIds, conflictIds };
}
