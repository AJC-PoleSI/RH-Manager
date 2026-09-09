/**
 * openings-diff — traduit un jeu de bandes en opérations sur `room_openings`.
 *
 * Fonction pure (tests dans openings-diff.test.ts). La grille admin manipule
 * des bandes ; la base connaît des ouvertures. Ce module fait le pont, et rien
 * d'autre : c'est l'appelant qui exécute les POST/PUT/DELETE.
 *
 * Règle d'identité : une bande issue de la base porte l'id de son ouverture.
 * Une bande tracée à la souris porte un id local. Une bande qui disparaît
 * (supprimée, ou absorbée par la fusion d'une voisine) devient une suppression.
 *
 * Spec : docs/superpowers/specs/2026-09-09-refonte-creneaux-bandes-design.md
 */

import { minutesToHHMM, hhmmToMinutes, type Band } from "./time-bands";

export interface OpeningRow {
  id: string;
  room: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" */
  start_time: string;
  end_time: string;
}

export interface OpeningCreate {
  room: string;
  date: string;
  startTime: string;
  endTime: string;
}

export interface OpeningUpdate extends OpeningCreate {
  id: string;
}

export interface OpeningsDiff {
  toCreate: OpeningCreate[];
  toUpdate: OpeningUpdate[];
  toDelete: string[];
  unchanged: number;
}

/** Bandes affichables depuis les ouvertures d'une épreuve. */
export function openingsToBands(
  openings: OpeningRow[],
  dayKeys: string[],
): Band[] {
  return openings
    .map((o) => {
      const dayIndex = dayKeys.indexOf(String(o.date).slice(0, 10));
      if (dayIndex < 0) return null;
      return {
        id: o.id,
        dayIndex,
        laneId: o.room,
        startMin: hhmmToMinutes(String(o.start_time)),
        endMin: hhmmToMinutes(String(o.end_time)),
      } as Band;
    })
    .filter((b): b is Band => b !== null);
}

/**
 * Compare l'état affiché à l'état chargé.
 *
 * `dayKeys` donne la date de chaque colonne. Les ouvertures dont la date n'est
 * PAS dans la semaine affichée sont ignorées de bout en bout : on ne supprime
 * jamais ce qu'on n'a pas montré.
 */
export function diffOpenings(
  initial: OpeningRow[],
  bands: Band[],
  dayKeys: string[],
): OpeningsDiff {
  const visible = initial.filter((o) =>
    dayKeys.includes(String(o.date).slice(0, 10)),
  );
  const byId = new Map(visible.map((o) => [o.id, o]));

  const toCreate: OpeningCreate[] = [];
  const toUpdate: OpeningUpdate[] = [];
  const seen = new Set<string>();
  let unchanged = 0;

  for (const b of bands) {
    const date = dayKeys[b.dayIndex];
    if (!date) continue;
    const next: OpeningCreate = {
      room: b.laneId,
      date,
      startTime: minutesToHHMM(b.startMin),
      endTime: minutesToHHMM(b.endMin),
    };

    const current = byId.get(b.id);
    if (!current) {
      toCreate.push(next);
      continue;
    }
    seen.add(b.id);

    const same =
      current.room === next.room &&
      String(current.date).slice(0, 10) === next.date &&
      String(current.start_time).slice(0, 5) === next.startTime &&
      String(current.end_time).slice(0, 5) === next.endTime;

    if (same) unchanged++;
    else toUpdate.push({ id: b.id, ...next });
  }

  const toDelete = visible.filter((o) => !seen.has(o.id)).map((o) => o.id);

  return { toCreate, toUpdate, toDelete, unchanged };
}
