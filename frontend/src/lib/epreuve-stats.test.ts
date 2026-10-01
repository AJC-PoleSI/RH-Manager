import { describe, it, expect } from "vitest";
import { computeEpreuveStats, type EpreuveScoreInput } from "./epreuve-stats";

const note = (
  candidateId: string,
  obtained: number,
  over: Partial<EpreuveScoreInput> = {},
): EpreuveScoreInput => ({
  epreuveKey: "ep1",
  epreuveName: "Entretien",
  tour: 1,
  candidateId,
  candidateName: candidateId,
  obtained,
  maxTotal: 40,
  ...over,
});

describe("computeEpreuveStats", () => {
  it("ramène chaque note à /20 selon le barème de l'épreuve", () => {
    const [ep] = computeEpreuveStats([note("a", 30), note("b", 20)]);
    expect(ep.candidates.map(c => c.scoreOn20)).toEqual([15, 10]);
    expect(ep.average).toBe(12.5);
    expect(ep.min).toBe(10);
    expect(ep.max).toBe(15);
  });

  it("un candidat noté par deux examinateurs ne compte pas double", () => {
    // a : (40 + 20) / 2 = 30/40 → 15/20 ; b : 10/40 → 5/20.
    const [ep] = computeEpreuveStats([note("a", 40), note("a", 20), note("b", 10)]);
    expect(ep.candidates.find(c => c.candidateId === "a")).toMatchObject({ scoreOn20: 15, evalCount: 2 });
    expect(ep.average).toBe(10);
    expect(ep.evalCount).toBe(3);
  });

  it("sépare les épreuves et range le tour le plus récent en premier", () => {
    const stats = computeEpreuveStats([
      note("a", 20),
      note("a", 4, { epreuveKey: "ep2", epreuveName: "Business game", tour: 2, maxTotal: 5 }),
    ]);
    expect(stats.map(s => s.epreuveKey)).toEqual(["ep2", "ep1"]);
    expect(stats[0].average).toBe(16);
  });

  it("écarte les barèmes inconnus et ne crée pas d'épreuve vide", () => {
    expect(computeEpreuveStats([note("a", 10, { maxTotal: 0 })])).toEqual([]);
  });

  it("borne une note hors barème à 20/20", () => {
    const [ep] = computeEpreuveStats([note("a", 50)]);
    expect(ep.average).toBe(20);
  });
});
