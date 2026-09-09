/**
 * time-bands — logique PURE de la saisie par bandes horaires.
 *
 * Aucun import, aucun accès réseau : tout est déterministe et testé
 * unitairement (time-bands.test.ts). Le composant TimeBandGrid ne fait que
 * traduire des gestes de souris en appels à ces fonctions.
 *
 * Spec : docs/superpowers/specs/2026-09-09-refonte-creneaux-bandes-design.md
 */

// ─── Amplitude de la grille ───────────────────────────────────────────
//
// 8h00 → 20h30. Le bord haut n'est pas négociable (aucune donnée avant 8h),
// le bord bas est fixé à 20h30 parce que les disponibilités réellement
// saisies vont jusqu'à 20h20 : couper à 20h00 tronquerait 30 dispos et
// 21 créneaux existants.
export const GRID_START_MIN = 8 * 60;
export const GRID_END_MIN = 20 * 60 + 30;
export const GRID_SPAN_MIN = GRID_END_MIN - GRID_START_MIN;

/**
 * Pas d'aimantation pendant le glissement.
 *
 * 15 min : le geste reste net et l'étiquette ne saute pas dans tous les sens.
 * On ne cherche pas la précision ici — le geste est explicitement approximatif,
 * la précision vient de l'édition (SNAP_EDIT).
 */
export const SNAP_DRAG = 15;

/** Pas d'aimantation à l'édition fine d'une bande existante. */
export const SNAP_EDIT = 5;

/** Durée minimale d'une bande. En dessous, le geste est un clic, pas un tracé. */
export const MIN_BAND_MIN = 15;

// ─── Types ────────────────────────────────────────────────────────────

export interface Band {
  /** Identifiant local ; les bandes fusionnées héritent de celui de la première. */
  id: string;
  /** 0 = lundi … 4 = vendredi. */
  dayIndex: number;
  /** Piste dans la journée : une salle côté admin, "" côté examinateur. */
  laneId: string;
  startMin: number;
  endMin: number;
}

export interface Interval {
  start: number;
  end: number;
}

// ─── Conversions ──────────────────────────────────────────────────────

export function minutesToHHMM(min: number): string {
  const m = Math.max(0, Math.round(min));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = String(hhmm).slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Libellé lisible d'une durée : 90 → "1h30", 60 → "1h", 45 → "45 min". */
export function formatDuration(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  if (r === 0) return `${h}h`;
  return `${h}h${String(r).padStart(2, "0")}`;
}

// ─── Aimantation et bornage ───────────────────────────────────────────

/** Arrondit au multiple de `step` le plus proche. */
export function snap(min: number, step: number): number {
  if (step <= 0) return Math.round(min);
  return Math.round(min / step) * step;
}

/** Ramène une minute dans l'amplitude de la grille. */
export function clampToGrid(min: number): number {
  return Math.min(GRID_END_MIN, Math.max(GRID_START_MIN, min));
}

/**
 * Position verticale (0→1) d'une minute dans la grille, et l'inverse.
 * Le composant s'en sert pour convertir des pixels en heures et réciproquement.
 */
export function minToRatio(min: number): number {
  return (min - GRID_START_MIN) / GRID_SPAN_MIN;
}

export function ratioToMin(ratio: number): number {
  return GRID_START_MIN + ratio * GRID_SPAN_MIN;
}

// ─── Fusion ───────────────────────────────────────────────────────────

/**
 * Fusionne des intervalles qui se chevauchent ou dont l'écart ne dépasse pas
 * `tolerance` minutes.
 *
 * `tolerance = 0` ne fusionne que ce qui se touche ou se chevauche
 * (c'est le cas de l'édition interactive). Une tolérance plus large sert à la
 * reprise des données historiques, où deux cases cochées séparées d'un
 * roulement de 5 ou 10 minutes décrivent en réalité une seule présence.
 *
 * Les intervalles vides ou inversés sont écartés.
 */
export function mergeIntervals(
  intervals: Interval[],
  tolerance = 0,
): Interval[] {
  const clean = intervals
    .filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end))
    .map((i) => ({ start: Math.min(i.start, i.end), end: Math.max(i.start, i.end) }))
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const out: Interval[] = [];
  for (const iv of clean) {
    const last = out[out.length - 1];
    if (last && iv.start - last.end <= tolerance) {
      last.end = Math.max(last.end, iv.end);
    } else {
      out.push({ ...iv });
    }
  }
  return out;
}

/**
 * Remet un jeu de bandes au propre : bandes inversées redressées, bandes trop
 * courtes écartées, bornage à la grille, puis fusion de ce qui se touche —
 * indépendamment par jour et par piste.
 *
 * Appelée après CHAQUE geste. C'est ce qui fait qu'un redimensionnement qui
 * amène une bande contre sa voisine produit une seule bande continue, sans
 * que l'utilisateur ait à s'en occuper.
 */
export function normalizeBands(bands: Band[]): Band[] {
  // Regroupement par (jour, piste). Un objet plutôt qu'une Map : la cible
  // TypeScript du projet n'autorise pas l'itération directe d'une Map.
  const groups: Record<string, Band[]> = {};
  for (const b of bands) {
    const key = `${b.dayIndex}|${b.laneId}`;
    (groups[key] ||= []).push(b);
  }

  const out: Band[] = [];
  for (const key of Object.keys(groups)) {
    const clean: Band[] = groups[key]
      .map((b: Band) => ({
        ...b,
        startMin: clampToGrid(Math.min(b.startMin, b.endMin)),
        endMin: clampToGrid(Math.max(b.startMin, b.endMin)),
      }))
      .filter((b: Band) => b.endMin - b.startMin >= MIN_BAND_MIN)
      .sort((a: Band, b: Band) => a.startMin - b.startMin || a.endMin - b.endMin);

    let run: Band | null = null;
    for (const b of clean) {
      if (run && b.startMin <= run.endMin) {
        // Fusion : on conserve l'identifiant de la première bande de la série,
        // pour que React ne remonte pas l'élément et ne casse pas l'animation.
        run.endMin = Math.max(run.endMin, b.endMin);
      } else {
        run = { ...b };
        out.push(run);
      }
    }
  }

  return out.sort(
    (a, b) =>
      a.dayIndex - b.dayIndex ||
      a.laneId.localeCompare(b.laneId) ||
      a.startMin - b.startMin,
  );
}

/**
 * Bande née d'un glissement : les deux extrémités sont aimantées au pas de
 * glissement, et le résultat est borné à la grille. Un geste trop court
 * (simple clic) renvoie null — c'est au composant d'y voir une sélection.
 */
export function bandFromDrag(
  anchorMin: number,
  cursorMin: number,
  step: number = SNAP_DRAG,
): Interval | null {
  const a = clampToGrid(snap(anchorMin, step));
  const b = clampToGrid(snap(cursorMin, step));
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  if (end - start < MIN_BAND_MIN) return null;
  return { start, end };
}
