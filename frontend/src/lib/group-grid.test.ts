import { describe, it, expect } from "vitest";
import {
  DEFAULT_GROUP_GRID,
  GROUP_EVALUATION_MAX,
  GROUP_EVALUATION_QUESTIONS,
  resolveGroupGrid,
} from "./group-evaluation-criteria";

describe("resolveGroupGrid", () => {
  it("sans réglage → la grille actuelle de 43 points, inchangée (Tour 1)", () => {
    for (const raw of [null, undefined, "", "{", [], 42]) {
      const grid = resolveGroupGrid(raw);
      expect(grid).toBe(DEFAULT_GROUP_GRID);
    }
    expect(DEFAULT_GROUP_GRID).toMatchObject({
      disabled: false,
      questions: GROUP_EVALUATION_QUESTIONS,
      maxTotal: GROUP_EVALUATION_MAX,
    });
    expect(GROUP_EVALUATION_MAX).toBe(43);
  });

  it("{ disabled: true } → pas d'évaluation du groupe", () => {
    expect(resolveGroupGrid({ disabled: true })).toEqual({ disabled: true });
    expect(resolveGroupGrid('{"disabled":true}')).toEqual({ disabled: true });
  });

  it("grille propre à l'épreuve, barèmes normalisés", () => {
    const grid = resolveGroupGrid({
      title: "Groupe T3",
      questions: [
        { q: "Coopération", weight: 5 },
        { q: "Synthèse", input: "checkbox", weight: 3 },
      ],
    });
    expect(grid).toMatchObject({
      disabled: false,
      title: "Groupe T3",
      maxTotal: 6,
    });
  });

  it("grille propre vide → grille par défaut", () => {
    expect(resolveGroupGrid({ title: "x", questions: [] })).toBe(DEFAULT_GROUP_GRID);
  });
});
