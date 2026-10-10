// Épreuve sur table BLOQUANTE : pendant qu'elle se tient, aucun autre
// entretien n'a lieu — toutes épreuves, tous pôles, sans exception.
//
// Demande de Felix (10/10/2026), pour l'an prochain : « l'épreuve sur table
// de lundi doit enlever tous les autres entretiens ». Les candidats sont
// tous convoqués à l'épreuve commune : un créneau qui la chevauche ne peut
// pas se tenir. Option par épreuve, désactivée par défaut
// (`epreuves.blocage_autres_epreuves`, migration
// supabase-migration-epreuve-sur-table-bloquante.sql) :
//   - null       → rien n'est bloqué (comportement historique) ;
//   - "pendant"  → de l'heure de convocation à heure + durée de l'épreuve ;
//   - "journee"  → toute la journée.
// Sans heure de convocation, "pendant" bloque la journée entière : on ne
// sait pas quand l'épreuve a lieu, on ne prend pas de risque.
//
// Fonctions pures, sans import — testées dans epreuve-bloquante.test.ts.
// Le chargement depuis la base vit dans epreuve-bloquante-db.ts.

export type BlocageMode = "pendant" | "journee";

export interface BlockingWindow {
  epreuveId: string;
  name: string;
  /** Jour de l'épreuve, "YYYY-MM-DD". */
  date: string;
  /** Minutes depuis minuit ; [startMin, endMin[ */
  startMin: number;
  endMin: number;
  wholeDay: boolean;
}

const DAY_END = 24 * 60;

function t2m(t: string): number {
  const [h, m] = String(t).slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function m2t(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Valeur de la colonne (ou du formulaire) → mode, ou null si désactivé. */
export function parseBlocageMode(v: unknown): BlocageMode | null {
  return v === "pendant" || v === "journee" ? v : null;
}

/** Jour "YYYY-MM-DD" d'une date stockée (ISO, timestamptz ou déjà un jour). */
export function dayOf(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/**
 * Fenêtre bloquée par une épreuve, ou null si elle ne bloque rien.
 * Seules les épreuves sur table (type `commune`) peuvent bloquer.
 */
export function blockingWindowOf(epreuve: any): BlockingWindow | null {
  if (!epreuve || epreuve.type !== "commune") return null;
  const mode = parseBlocageMode(epreuve.blocage_autres_epreuves);
  if (!mode) return null;
  const date = dayOf(epreuve.date_debut);
  if (!date) return null;

  const base = {
    epreuveId: String(epreuve.id),
    name: String(epreuve.name || "Épreuve sur table"),
    date,
  };
  const heure = String(epreuve.heure_debut ?? "").trim();
  if (mode === "journee" || !/^\d{1,2}:\d{2}/.test(heure)) {
    return { ...base, startMin: 0, endMin: DAY_END, wholeDay: true };
  }
  const startMin = t2m(heure);
  const duration = Number(epreuve.duration_minutes) > 0
    ? Number(epreuve.duration_minutes)
    : 60;
  return {
    ...base,
    startMin,
    endMin: Math.min(DAY_END, startMin + duration),
    wholeDay: false,
  };
}

export function blockingWindowsOf(epreuves: any[]): BlockingWindow[] {
  const out: BlockingWindow[] = [];
  for (const e of epreuves || []) {
    const w = blockingWindowOf(e);
    if (w) out.push(w);
  }
  return out;
}

/**
 * Première fenêtre qui chevauche un créneau (jour, début, fin), ou null.
 * `ignoreEpreuveId` : l'épreuve bloquante ne se bloque pas elle-même.
 */
export function findBlockingWindow(
  windows: BlockingWindow[],
  date: unknown,
  startMin: number,
  endMin: number,
  ignoreEpreuveId?: string | null,
): BlockingWindow | null {
  const day = dayOf(date);
  if (!day) return null;
  for (const w of windows) {
    if (w.date !== day) continue;
    if (ignoreEpreuveId && w.epreuveId === ignoreEpreuveId) continue;
    if (startMin < w.endMin && w.startMin < endMin) return w;
  }
  return null;
}

/** Même test pour un créneau tel que stocké (date, start_time, end_time). */
export function slotBlockedBy(
  windows: BlockingWindow[],
  slot: { date: unknown; start_time: string; end_time: string; epreuve_id?: string | null },
): BlockingWindow | null {
  if (windows.length === 0) return null;
  return findBlockingWindow(
    windows,
    slot.date,
    t2m(slot.start_time),
    t2m(slot.end_time),
    slot.epreuve_id,
  );
}

/**
 * Plages bloquées d'un jour, au format du découpage des ouvertures
 * (opening-slicer : traitées comme des pauses).
 */
export function blockedRangesOn(
  windows: BlockingWindow[],
  date: unknown,
  ignoreEpreuveId?: string | null,
): Array<{ start: string; end: string }> {
  const day = dayOf(date);
  if (!day) return [];
  return windows
    .filter(
      (w) =>
        w.date === day && !(ignoreEpreuveId && w.epreuveId === ignoreEpreuveId),
    )
    .map((w) => ({ start: m2t(w.startMin), end: m2t(w.endMin) }));
}

/** « le 12/10 de 14:00 à 16:00 » / « toute la journée du 12/10 ». */
export function describeWindow(w: BlockingWindow): string {
  const [, mm, dd] = w.date.split("-");
  const jour = `${dd}/${mm}`;
  return w.wholeDay
    ? `toute la journée du ${jour}`
    : `le ${jour} de ${m2t(w.startMin)} à ${m2t(w.endMin)}`;
}

export function blockingMessage(w: BlockingWindow): string {
  return `L'épreuve sur table « ${w.name} » bloque tous les autres entretiens ${describeWindow(w)}.`;
}
