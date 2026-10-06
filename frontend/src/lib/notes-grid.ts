// « Détail des notes » de la page Délibérations : un tableau candidats ×
// épreuves pour comparer les notes d'un tour.
//
// Mêmes règles que la moyenne d'un candidat (averageOn20ByEpreuve) :
//   - une note est ramenée à /20 selon le barème de son épreuve ;
//   - les notes de plusieurs examinateurs sur un MÊME candidat et une MÊME
//     épreuve sont moyennées entre elles (un binôme ne compte pas double) ;
//   - la moyenne d'un candidat pèse chaque épreuve au prorata de son barème,
//     ou par le coefficient choisi par l'admin s'il y en a un (Réglages →
//     Coefficients, 07/10/2026 — cf. effectiveCoefficient) ;
//   - la moyenne d'une épreuve donne un poids égal à chaque candidat noté.
// Grilles vides et anciennes notes collectives : écartées par l'appelant.
//
// Module sans dépendance serveur : il est importé par la page client.

import { averageOn20ByEpreuve, effectiveCoefficient } from "./evaluation-criteria";

export interface GridNote {
  /** Identifiant de l'épreuve (deuxième grille : `${id}:second`). */
  epreuveKey: string;
  epreuveName: string;
  tour: number | null;
  /** Total obtenu sur la grille. */
  obtained: number;
  /** Total de points de l'épreuve (somme des barèmes de ses critères). */
  maxTotal: number;
  /** Coefficient choisi par l'admin ; absent ou null = barème ÷ 20. */
  coef?: number | null;
}

export interface GridCandidateInput {
  candidateId: string;
  notes: GridNote[];
}

export interface GridColumn {
  key: string;
  name: string;
  tour: number | null;
  maxTotal: number;
  /** Poids EFFECTIF dans la moyenne du candidat : coefficient choisi, sinon barème / 20. */
  coef: number;
}

export interface GridCell {
  /** Moyenne /20 des examinateurs, au dixième. */
  scoreOn20: number;
  /** Nombre de notes moyennées. */
  count: number;
}

export interface GridRow {
  candidateId: string;
  cells: Record<string, GridCell>;
  /** Moyenne pondérée /20 sur les épreuves retenues ; null sans note. */
  average: number | null;
}

export interface ColumnStats {
  average: number;
  min: number;
  max: number;
  /** Candidats notés. */
  count: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const isUsable = (n: GridNote) =>
  Number.isFinite(Number(n.maxTotal)) &&
  Number(n.maxTotal) > 0 &&
  Number.isFinite(Number(n.obtained));

/**
 * Épreuves ayant au moins une note, rangées par tour puis par nom — la
 * deuxième grille (« Entretien — Propale ») suit ainsi son épreuve.
 */
export function listColumns(inputs: GridCandidateInput[]): GridColumn[] {
  const byKey = new Map<string, GridColumn>();
  for (const c of inputs) {
    for (const n of c.notes) {
      if (!isUsable(n) || byKey.has(n.epreuveKey)) continue;
      const maxTotal = Number(n.maxTotal);
      byKey.set(n.epreuveKey, {
        key: n.epreuveKey,
        name: n.epreuveName,
        tour: n.tour,
        maxTotal,
        coef: effectiveCoefficient(n.coef, maxTotal),
      });
    }
  }
  return Array.from(byKey.values()).sort(
    (a, b) => (a.tour ?? 0) - (b.tour ?? 0) || a.name.localeCompare(b.name, "fr"),
  );
}

/** Une ligne par candidat, restreinte aux épreuves `keys`. */
export function buildRows(inputs: GridCandidateInput[], keys: Set<string>): GridRow[] {
  return inputs.map((c) => {
    const notes = c.notes.filter((n) => keys.has(n.epreuveKey) && isUsable(n));
    const ratios = new Map<string, number[]>();
    for (const n of notes) {
      const r = Math.min(1, Math.max(0, Number(n.obtained) / Number(n.maxTotal)));
      ratios.set(n.epreuveKey, [...(ratios.get(n.epreuveKey) || []), r]);
    }
    const cells: Record<string, GridCell> = {};
    ratios.forEach((rs, key) => {
      cells[key] = {
        scoreOn20: round1((rs.reduce((a, b) => a + b, 0) / rs.length) * 20),
        count: rs.length,
      };
    });
    return {
      candidateId: c.candidateId,
      cells,
      average: averageOn20ByEpreuve(
        notes.map((n) => ({
          epreuveKey: n.epreuveKey,
          obtained: Number(n.obtained),
          maxTotal: Number(n.maxTotal),
          coef: n.coef,
        })),
      ),
    };
  });
}

function stats(values: number[]): ColumnStats | null {
  if (values.length === 0) return null;
  return {
    average: round1(values.reduce((a, b) => a + b, 0) / values.length),
    min: Math.min(...values),
    max: Math.max(...values),
    count: values.length,
  };
}

/** Moyenne, min et max de chaque épreuve sur un lot de lignes (un pôle…). */
export function columnStats(
  rows: GridRow[],
  keys: string[],
): Record<string, ColumnStats | null> {
  const out: Record<string, ColumnStats | null> = {};
  for (const key of keys) {
    out[key] = stats(rows.flatMap((r) => (r.cells[key] ? [r.cells[key].scoreOn20] : [])));
  }
  return out;
}

/** Statistiques de la colonne « Moyenne » (moyenne des moyennes). */
export function averageStats(rows: GridRow[]): ColumnStats | null {
  return stats(rows.flatMap((r) => (r.average !== null ? [r.average] : [])));
}

/** Tri : « average », « name » ou la clé d'une épreuve. */
export type GridSortKey = "average" | "name" | string;

/**
 * Trie les lignes ; un candidat sans note sur le critère de tri finit
 * toujours en bas, quel que soit le sens. À égalité : ordre alphabétique.
 */
export function sortRows(
  rows: GridRow[],
  by: GridSortKey,
  dir: "asc" | "desc",
  nameOf: (candidateId: string) => string,
): GridRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const byName = (a: GridRow, b: GridRow) =>
    nameOf(a.candidateId).localeCompare(nameOf(b.candidateId), "fr");
  if (by === "name") return [...rows].sort((a, b) => sign * byName(a, b));
  const valueOf = (r: GridRow): number | null =>
    by === "average" ? r.average : r.cells[by]?.scoreOn20 ?? null;
  return [...rows].sort((a, b) => {
    const va = valueOf(a);
    const vb = valueOf(b);
    if (va === null && vb === null) return byName(a, b);
    if (va === null) return 1;
    if (vb === null) return -1;
    return sign * (va - vb) || byName(a, b);
  });
}
