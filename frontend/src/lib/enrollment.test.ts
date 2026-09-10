import { describe, it, expect } from "vitest";
import { effectiveMaxCandidates, isActiveEnrollment } from "./enrollment";

describe("isActiveEnrollment", () => {
  it("null/undefined = ligne legacy sans statut → actif", () => {
    expect(isActiveEnrollment(null)).toBe(true);
    expect(isActiveEnrollment(undefined)).toBe(true);
  });

  it("active / enrolled → actif, cancelled → pas actif", () => {
    expect(isActiveEnrollment("active")).toBe(true);
    expect(isActiveEnrollment("enrolled")).toBe(true);
    expect(isActiveEnrollment("cancelled")).toBe(false);
  });
});

describe("effectiveMaxCandidates — épreuve individuelle", () => {
  it("utilise max_candidates tel quel", () => {
    expect(effectiveMaxCandidates({ max_candidates: 1 })).toBe(1);
  });

  it("défaut à 1 si absent", () => {
    expect(effectiveMaxCandidates({})).toBe(1);
  });
});

describe("effectiveMaxCandidates — épreuve de groupe, sans info examinateurs (members absent)", () => {
  it("replié sur group_size (comportement historique — dispatch, capacity-check)", () => {
    const r = effectiveMaxCandidates({
      max_candidates: 1,
      epreuve: { is_group_epreuve: true, group_size: 6 },
    });
    expect(r).toBe(6);
  });
});

describe("effectiveMaxCandidates — épreuve de groupe, avec examinateurs affectés (members fourni)", () => {
  it("plafonnée par le nombre d'examinateurs si < group_size", () => {
    const r = effectiveMaxCandidates({
      max_candidates: 6,
      epreuve: { is_group_epreuve: true, group_size: 6 },
      members: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
    });
    expect(r).toBe(3);
  });

  it("plafonnée par group_size même si plus d'examinateurs sont staffés", () => {
    const r = effectiveMaxCandidates({
      max_candidates: 6,
      epreuve: { is_group_epreuve: true, group_size: 6 },
      members: Array.from({ length: 8 }, (_, i) => ({ id: `m${i}` })),
    });
    expect(r).toBe(6);
  });

  it("0 examinateur affecté → capacité candidats nulle", () => {
    const r = effectiveMaxCandidates({
      max_candidates: 6,
      epreuve: { is_group_epreuve: true, group_size: 6 },
      members: [],
    });
    expect(r).toBe(0);
  });
});
