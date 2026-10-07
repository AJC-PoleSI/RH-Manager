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

describe("effectiveMaxCandidates — business game d'un pôle (BG Trésorerie)", () => {
  it("2 examinateurs suffisent pour un groupe complet de 4", () => {
    const r = effectiveMaxCandidates({
      max_candidates: 4,
      epreuve: { is_group_epreuve: true, group_size: 4, is_pole_test: true },
      members: [{ id: "arthur" }, { id: "maeva" }],
    });
    expect(r).toBe(4);
  });

  it("aucun examinateur → aucun candidat", () => {
    const r = effectiveMaxCandidates({
      max_candidates: 4,
      epreuve: { is_group_epreuve: true, group_size: 4, is_pole_test: true },
      members: [],
    });
    expect(r).toBe(0);
  });

  it("le business game commun garde un candidat par examinateur", () => {
    const r = effectiveMaxCandidates({
      max_candidates: 3,
      epreuve: { is_group_epreuve: true, group_size: 3, is_pole_test: false },
      members: [{ id: "m1" }, { id: "m2" }],
    });
    expect(r).toBe(2);
  });
});
