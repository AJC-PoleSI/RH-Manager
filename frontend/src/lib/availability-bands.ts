/**
 * availability-bands — pont entre les lignes `availabilities` en base et les
 * bandes affichées par TimeBandGrid.
 *
 * Fonctions pures, sans I/O (tests dans availability-bands.test.ts).
 *
 * Le point important : la conversion se fait À LA LECTURE. Tant que le membre
 * n'enregistre pas, la base n'est pas touchée — les 950 lignes historiques
 * restent telles quelles. C'est ce qui permet de déployer la nouvelle grille
 * sans rien faire re-saisir à personne.
 *
 * Spec : docs/superpowers/specs/2026-09-09-refonte-creneaux-bandes-design.md
 */

import { hhmmToMinutes, mergeIntervals, type Band } from "./time-bands";

/**
 * Écart maximal entre deux créneaux cochés pour qu'ils décrivent la même
 * présence.
 *
 * Les créneaux se suivent avec un roulement de 5 à 10 minutes : deux cases
 * séparées d'un quart d'heure appartiennent à la même plage de présence, pas
 * à deux venues distinctes. Au-delà, on conserve deux bandes.
 *
 * Le choix de 15 min est borné par la sécurité : c'est moins que la plus
 * courte épreuve (20 min), donc la fusion seule ne peut pas rendre un
 * examinateur éligible à un créneau qu'il n'avait pas coché.
 */
export const MERGE_TOLERANCE_MIN = 15;

/** Jours ouvrés affichés, dans l'ordre des colonnes de la grille. */
export const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri"] as const;

export interface AvailabilityRow {
  id?: string;
  date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
}

export interface AvailabilityPayloadRow {
  weekday: string;
  date: string;
  startTime: string;
  endTime: string;
}

/** "YYYY-MM-DD" d'une Date locale, sans passer par UTC. */
export function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Lignes de la base → bandes affichables.
 *
 * On compare des chaînes "YYYY-MM-DD" plutôt que des objets Date : la colonne
 * est un TIMESTAMPTZ stocké à midi UTC, et un `new Date(...)` suivi d'un
 * `getDate()` peut basculer d'un jour selon le fuseau. La comparaison
 * textuelle est stable partout.
 */
export function rowsToBands(rows: AvailabilityRow[], days: Date[]): Band[] {
  const dayIndexOf = new Map<string, number>();
  days.forEach((d, i) => dayIndexOf.set(localYmd(d), i));

  const byDay = new Map<number, { start: number; end: number }[]>();
  for (const r of rows) {
    if (!r.date || !r.start_time || !r.end_time) continue;
    const idx = dayIndexOf.get(String(r.date).slice(0, 10));
    if (idx === undefined) continue;
    const list = byDay.get(idx) ?? [];
    list.push({
      start: hhmmToMinutes(String(r.start_time)),
      end: hhmmToMinutes(String(r.end_time)),
    });
    byDay.set(idx, list);
  }

  const bands: Band[] = [];
  byDay.forEach((intervals, dayIndex) => {
    mergeIntervals(intervals, MERGE_TOLERANCE_MIN).forEach((iv, k) => {
      bands.push({
        id: `av-${dayIndex}-${k}-${iv.start}`,
        dayIndex,
        laneId: "",
        startMin: iv.start,
        endMin: iv.end,
      });
    });
  });

  return bands.sort((a, b) => a.dayIndex - b.dayIndex || a.startMin - b.startMin);
}

/**
 * Bandes → charge utile attendue par PUT /api/availability.
 *
 * La date est fixée à midi local : l'API la renvoie en ISO, et midi met le
 * jour à l'abri de n'importe quel décalage de fuseau (même convention que
 * l'ancienne page de saisie).
 */
export function bandsToRows(bands: Band[], days: Date[]): AvailabilityPayloadRow[] {
  return bands
    .filter((b) => days[b.dayIndex])
    .map((b) => ({
      weekday: WEEKDAY_KEYS[b.dayIndex] ?? "mon",
      date: new Date(`${localYmd(days[b.dayIndex])}T12:00:00`).toISOString(),
      startTime: minutes(b.startMin),
      endTime: minutes(b.endMin),
    }));
}

function minutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
