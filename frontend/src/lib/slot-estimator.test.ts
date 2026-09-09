import { describe, it, expect } from "vitest";
import { estimateSlotsNeeded, formatSlotEstimate } from "./slot-estimator";

describe("estimateSlotsNeeded — épreuve individuelle", () => {
  it("100 candidats, marge 25% → 125 créneaux", () => {
    const r = estimateSlotsNeeded({ candidatsAttendus: 100, margePct: 25 });
    expect(r).toEqual({ applicable: true, min: 125, max: 125 });
  });

  it("arrondit au créneau supérieur", () => {
    const r = estimateSlotsNeeded({ candidatsAttendus: 33, margePct: 25 });
    expect(r.min).toBe(Math.ceil(33 * 1.25));
  });

  it("marge à 0 : autant de créneaux que de candidats", () => {
    const r = estimateSlotsNeeded({ candidatsAttendus: 50, margePct: 0 });
    expect(r).toEqual({ applicable: true, min: 50, max: 50 });
  });

  it("marge non renseignée : traitée comme 0, pas comme une erreur", () => {
    const r = estimateSlotsNeeded({ candidatsAttendus: 50, margePct: null });
    expect(r.min).toBe(50);
  });
});

describe("estimateSlotsNeeded — épreuve de groupe", () => {
  it("Business Game : 100 candidats, 4-6 par groupe, marge 25% → 17 à 32", () => {
    const r = estimateSlotsNeeded({
      candidatsAttendus: 100,
      margePct: 25,
      isGroupEpreuve: true,
      groupSize: 6,
      minCandidates: 4,
    });
    expect(r).toEqual({ applicable: true, min: 17, max: 32 });
  });

  it("group_size absent : replié sur 1 (jamais de division par zéro)", () => {
    const r = estimateSlotsNeeded({
      candidatsAttendus: 10,
      margePct: 0,
      isGroupEpreuve: true,
      groupSize: null,
      minCandidates: null,
    });
    expect(r.applicable).toBe(true);
    expect(Number.isFinite(r.min)).toBe(true);
    expect(Number.isFinite(r.max)).toBe(true);
  });

  it("min_candidates absent : replié sur group_size", () => {
    const r = estimateSlotsNeeded({
      candidatsAttendus: 24,
      margePct: 0,
      isGroupEpreuve: true,
      groupSize: 6,
      minCandidates: null,
    });
    // Sans marge et minCandidates = groupSize, le plancher et le plafond coïncident.
    expect(r.min).toBe(4);
    expect(r.max).toBe(4);
  });
});

describe("cas non applicables", () => {
  it("candidatsAttendus absent", () => {
    expect(estimateSlotsNeeded({ candidatsAttendus: null, margePct: 25 }).applicable).toBe(false);
  });

  it("candidatsAttendus à zéro", () => {
    expect(estimateSlotsNeeded({ candidatsAttendus: 0, margePct: 25 }).applicable).toBe(false);
  });

  it("candidatsAttendus négatif", () => {
    expect(estimateSlotsNeeded({ candidatsAttendus: -5, margePct: 25 }).applicable).toBe(false);
  });

  it("candidatsAttendus non numérique", () => {
    expect(estimateSlotsNeeded({ candidatsAttendus: NaN, margePct: 25 }).applicable).toBe(false);
  });
});

describe("formatSlotEstimate", () => {
  it("valeur unique : singulier/pluriel correct", () => {
    expect(formatSlotEstimate({ applicable: true, min: 1, max: 1 })).toBe("1 créneau");
    expect(formatSlotEstimate({ applicable: true, min: 125, max: 125 })).toBe("125 créneaux");
  });

  it("fourchette", () => {
    expect(formatSlotEstimate({ applicable: true, min: 17, max: 32 })).toBe("17 à 32 créneaux");
  });

  it("non applicable : chaîne vide", () => {
    expect(formatSlotEstimate({ applicable: false, min: 0, max: 0 })).toBe("");
  });
});
