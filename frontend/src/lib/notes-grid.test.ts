import { describe, it, expect } from "vitest";
import {
  averageStats,
  buildRows,
  columnStats,
  listColumns,
  sortRows,
  type GridCandidateInput,
  type GridNote,
} from "./notes-grid";

const n = (epreuveKey: string, obtained: number, maxTotal = 20, extra: Partial<GridNote> = {}): GridNote => ({
  epreuveKey,
  epreuveName: epreuveKey,
  tour: 1,
  obtained,
  maxTotal,
  ...extra,
});

const inputs: GridCandidateInput[] = [
  // a : entretien noté en binôme (16 et 12 → 14), BG 4/5 → 16.
  { candidateId: "a", notes: [n("entretien", 16), n("entretien", 12), n("bg", 4, 5)] },
  { candidateId: "b", notes: [n("entretien", 10)] },
  { candidateId: "c", notes: [] },
];

describe("listColumns", () => {
  it("liste les épreuves notées, par tour puis par nom, avec leur coefficient", () => {
    const cols = listColumns(inputs);
    expect(cols.map((c) => c.key)).toEqual(["bg", "entretien"]);
    expect(cols[0].coef).toBe(0.25);
  });

  it("range la deuxième grille juste après son épreuve", () => {
    const cols = listColumns([
      {
        candidateId: "a",
        notes: [
          n("e1:second", 8, 10, { epreuveName: "RDV client — Propale" }),
          n("z", 5, 20, { epreuveName: "Test écrit" }),
          n("e1", 30, 40, { epreuveName: "RDV client" }),
        ],
      },
    ]);
    expect(cols.map((c) => c.key)).toEqual(["e1", "e1:second", "z"]);
  });
});

describe("buildRows", () => {
  it("moyenne les examinateurs par épreuve et pondère par barème", () => {
    const [a, b, c] = buildRows(inputs, new Set(["entretien", "bg"]));
    expect(a.cells.entretien).toEqual({ scoreOn20: 14, count: 2 });
    expect(a.cells.bg).toEqual({ scoreOn20: 16, count: 1 });
    // (0,7 × 1 + 0,8 × 0,25) / 1,25 = 0,72 → 14,4.
    expect(a.average).toBe(14.4);
    expect(b.average).toBe(10);
    expect(c.average).toBeNull();
  });

  it("ne garde que les épreuves sélectionnées", () => {
    const [a] = buildRows(inputs, new Set(["bg"]));
    expect(a.cells.entretien).toBeUndefined();
    expect(a.average).toBe(16);
  });
});

describe("columnStats / averageStats", () => {
  it("donne un poids égal à chaque candidat noté", () => {
    const rows = buildRows(inputs, new Set(["entretien", "bg"]));
    expect(columnStats(rows, ["entretien", "bg"])).toEqual({
      entretien: { average: 12, min: 10, max: 14, count: 2 },
      bg: { average: 16, min: 16, max: 16, count: 1 },
    });
    expect(averageStats(rows)).toEqual({ average: 12.2, min: 10, max: 14.4, count: 2 });
  });

  it("renvoie null pour une épreuve sans note", () => {
    expect(columnStats(buildRows(inputs, new Set()), ["bg"])).toEqual({ bg: null });
  });
});

describe("sortRows", () => {
  const rows = buildRows(inputs, new Set(["entretien", "bg"]));
  const ids = (r: { candidateId: string }[]) => r.map((x) => x.candidateId);
  const name = (id: string) => ({ a: "Zoé", b: "Adam", c: "Marc" })[id] || id;

  it("trie par moyenne, les candidats sans note toujours en bas", () => {
    expect(ids(sortRows(rows, "average", "desc", name))).toEqual(["a", "b", "c"]);
    expect(ids(sortRows(rows, "average", "asc", name))).toEqual(["b", "a", "c"]);
  });

  it("trie par épreuve, les non-notés ensuite par ordre alphabétique", () => {
    // Seul a a une note de BG ; b (Adam) et c (Marc) suivent par nom.
    expect(ids(sortRows(rows, "bg", "asc", name))).toEqual(["a", "b", "c"]);
  });

  it("trie par nom", () => {
    expect(ids(sortRows(rows, "name", "asc", name))).toEqual(["b", "c", "a"]);
  });
});
