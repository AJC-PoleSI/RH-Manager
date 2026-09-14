import { describe, it, expect } from "vitest";
import { isFinalizedEvaluation } from "./evaluation-finalized";

describe("isFinalizedEvaluation", () => {
  it("une note renseignée suffit", () => {
    expect(isFinalizedEvaluation({ scores: { motivation: 14 } })).toBe(true);
  });

  it("un commentaire seul suffit", () => {
    expect(isFinalizedEvaluation({ scores: {}, comment: "Très bon profil" })).toBe(true);
  });

  it("scores en chaîne JSON (ligne ancienne)", () => {
    expect(isFinalizedEvaluation({ scores: '{"oral": 12}' })).toBe(true);
  });

  it("formulaire ouvert mais rien saisi → pas finalisée", () => {
    expect(
      isFinalizedEvaluation({ scores: { oral: null, ecrit: "" }, comment: "  " }),
    ).toBe(false);
  });

  it("ligne vide → pas finalisée", () => {
    expect(isFinalizedEvaluation({})).toBe(false);
    expect(isFinalizedEvaluation(null)).toBe(false);
  });

  it("scores illisibles → pas finalisée (pas de verrou fantôme)", () => {
    expect(isFinalizedEvaluation({ scores: "{pas du json" })).toBe(false);
  });

  it("NaN ne compte pas comme une note", () => {
    expect(isFinalizedEvaluation({ scores: { oral: NaN } })).toBe(false);
  });
});
