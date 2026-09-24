import { describe, it, expect } from "vitest";
import {
  closedTourNumbers,
  extractTourNumber,
  splitByClosedTour,
} from "./tour-archive";

describe("closedTourNumbers", () => {
  it("ne retient que les tours au statut « termine »", () => {
    const closed = closedTourNumbers([
      { name: "Tour 1", status: "termine" },
      { name: "Tour 2", status: "en_cours" },
      { name: "Tour 3", status: "a_venir" },
    ]);
    expect(Array.from(closed)).toEqual([1]);
  });

  it("garde le premier tour en cas de doublon de numéro", () => {
    const closed = closedTourNumbers([
      { name: "Tour 2", status: "en_cours" },
      { name: "Tour 2 (bis)", status: "termine" },
    ]);
    expect(closed.has(2)).toBe(false);
  });

  it("ignore les noms sans numéro et une réponse absente", () => {
    expect(closedTourNumbers([{ name: "Final", status: "termine" }]).size).toBe(0);
    expect(closedTourNumbers(null).size).toBe(0);
  });

  it("lit le numéro dans le nom du tour", () => {
    expect(extractTourNumber("Tour 3")).toBe(3);
    expect(extractTourNumber("Final")).toBe(0);
  });
});

describe("splitByClosedTour", () => {
  const items = [
    { id: "a", tour: 2 },
    { id: "b", tour: 1 },
    { id: "c", tour: 3 },
    { id: "d", tour: 1 },
    { id: "e", tour: null },
  ];

  it("range les tours clos dans l'archive, du plus récent au plus ancien", () => {
    const { current, archived } = splitByClosedTour(items, i => i.tour, new Set([1, 2]));
    expect(current.map(i => i.id)).toEqual(["c", "e"]);
    expect(archived.map(g => g.tour)).toEqual([2, 1]);
    expect(archived[1].items.map(i => i.id)).toEqual(["b", "d"]);
  });

  it("laisse dans le courant un élément au tour inconnu", () => {
    const { current } = splitByClosedTour([{ tour: undefined }, { tour: "?" }], i => i.tour, new Set([1]));
    expect(current).toHaveLength(2);
  });

  it("n'archive rien quand aucun tour n'est clos", () => {
    const { current, archived } = splitByClosedTour(items, i => i.tour, new Set());
    expect(current).toHaveLength(items.length);
    expect(archived).toEqual([]);
  });
});
