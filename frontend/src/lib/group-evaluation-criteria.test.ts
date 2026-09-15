import { describe, it, expect } from "vitest";
import {
  GROUP_EVALUATION_MAX,
  GROUP_EVALUATION_QUESTIONS,
  isLegacyCollectiveNote,
} from "./group-evaluation-criteria";
import {
  getCriterionLabel,
  getMaxPoints,
  validateScores,
} from "./evaluation-criteria";

// Changement du 15/09/2026 : sur une épreuve de groupe, la « note collective »
// partagée disparaît au profit d'une grille dédiée au travail DU GROUPE,
// remplie une seule fois par créneau et exclue des moyennes.

describe("GROUP_EVALUATION_QUESTIONS", () => {
  it("porte les 9 critères demandés, dans l'ordre", () => {
    expect(GROUP_EVALUATION_QUESTIONS.map(getCriterionLabel)).toEqual([
      "Entraide",
      "Temps",
      "Aboutissement",
      "Clarté du projet",
      "Budget",
      "Présentation",
      "Faisabilité",
      "Ambiance de groupe",
      "Bonus ou malus",
    ]);
  });

  it("note chaque critère sur 5, sauf le bonus/malus sur 3", () => {
    const maxima = GROUP_EVALUATION_QUESTIONS.map(getMaxPoints);
    expect(maxima).toEqual([5, 5, 5, 5, 5, 5, 5, 5, 3]);
  });

  it("totalise 43 points", () => {
    expect(GROUP_EVALUATION_MAX).toBe(43);
  });
});

describe("validation des notes de groupe", () => {
  it("accepte une grille dans le barème", () => {
    const scores = { 0: 5, 1: 4, 2: 3, 7: 5, 8: 3 };
    expect(validateScores(GROUP_EVALUATION_QUESTIONS, scores)).toBeNull();
  });

  it("refuse une note au-dessus du barème du critère", () => {
    const err = validateScores(GROUP_EVALUATION_QUESTIONS, { 0: 6 });
    expect(err).toMatchObject({ index: 0, maxPoints: 5, reason: "above_max" });
  });

  it("refuse un bonus/malus au-dessus de 3", () => {
    const err = validateScores(GROUP_EVALUATION_QUESTIONS, { 8: 4 });
    expect(err).toMatchObject({
      index: 8,
      label: "Bonus ou malus",
      maxPoints: 3,
    });
  });

  it("refuse une note négative", () => {
    const err = validateScores(GROUP_EVALUATION_QUESTIONS, { 3: -1 });
    expect(err).toMatchObject({ index: 3, reason: "negative" });
  });
});

describe("isLegacyCollectiveNote", () => {
  it("reconnaît une ancienne note collective d'épreuve de groupe", () => {
    expect(
      isLegacyCollectiveNote({
        is_group: true,
        epreuves: { is_group_epreuve: true },
      }),
    ).toBe(true);
  });

  it("épargne la note partagée d'un binôme sur un entretien", () => {
    // is_group=true mais l'épreuve n'est PAS « de groupe » : c'est une vraie
    // note, elle doit continuer de compter dans la moyenne.
    expect(
      isLegacyCollectiveNote({
        is_group: true,
        epreuves: { is_group_epreuve: false },
      }),
    ).toBe(false);
  });

  it("épargne l'avis individuel posé sur une épreuve de groupe", () => {
    expect(
      isLegacyCollectiveNote({
        is_group: false,
        epreuves: { is_group_epreuve: true },
      }),
    ).toBe(false);
  });

  it("accepte la forme camelCase renvoyée par les routes API", () => {
    expect(
      isLegacyCollectiveNote({
        isGroup: true,
        epreuves: { is_group_epreuve: true },
      }),
    ).toBe(true);
  });

  it("ne casse pas sur une évaluation sans épreuve jointe", () => {
    expect(isLegacyCollectiveNote({ is_group: true })).toBe(false);
  });
});
