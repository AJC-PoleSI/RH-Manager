import { describe, it, expect } from "vitest";
import {
  getCriterionInput,
  getCriterionSection,
  getCriterionSections,
  supportsDraftEvaluation,
  getMaxPoints,
  getTotalMaxPoints,
  normalizeQuestions,
  scoreValidationMessage,
  validateScores,
  type EvaluationCriterion,
} from "./evaluation-criteria";

// Critères à cocher (07/10/2026, brief notation T3 — F2). Un critère sans
// `input` doit se comporter EXACTEMENT comme avant : ces tests le vérifient
// autant que le nouveau comportement.

describe("getCriterionInput", () => {
  it("absent → saisie chiffrée (comportement historique)", () => {
    expect(getCriterionInput({ q: "Motivation", weight: 20 })).toBe("number");
    expect(getCriterionInput(null)).toBe("number");
  });

  it("valeurs reconnues", () => {
    expect(getCriterionInput({ q: "a", input: "checkbox" })).toBe("checkbox");
    expect(getCriterionInput({ q: "a", input: "scale", weight: 5 })).toBe("scale");
    expect(getCriterionInput({ q: "a", input: "problem_bank", weight: 8 })).toBe(
      "problem_bank",
    );
  });

  it("valeur inconnue → saisie chiffrée", () => {
    expect(getCriterionInput({ q: "a", input: "slider" })).toBe("number");
  });
});

describe("getCriterionSection", () => {
  it("renvoie le titre de bloc nettoyé, ou une chaîne vide", () => {
    expect(getCriterionSection({ q: "a", section: "  Le mail " })).toBe("Le mail");
    expect(getCriterionSection({ q: "a" })).toBe("");
  });
});

describe("parties d'une grille et notation en brouillon", () => {
  const sectioned: EvaluationCriterion[] = [
    { q: "a", section: "Le mail", input: "checkbox" },
    { q: "b", section: "Le mail", input: "checkbox" },
    { q: "c", section: "L'appel", input: "checkbox" },
    { q: "d", section: "L'échange groupé", input: "problem_bank", weight: 8 },
  ];

  it("liste les parties dans l'ordre, sans doublon", () => {
    expect(getCriterionSections(sectioned)).toEqual([
      "Le mail",
      "L'appel",
      "L'échange groupé",
    ]);
  });

  it("brouillon possible dès deux parties", () => {
    expect(supportsDraftEvaluation(sectioned)).toBe(true);
  });

  it("grille historique (sans partie, ou une seule) : pas de brouillon", () => {
    expect(supportsDraftEvaluation([{ q: "Motivation", weight: 20 }])).toBe(false);
    expect(
      supportsDraftEvaluation([
        { q: "a", section: "Seule", weight: 5 },
        { q: "b", weight: 5 },
      ]),
    ).toBe(false);
    expect(supportsDraftEvaluation(null)).toBe(false);
  });
});

describe("barème d'une case à cocher", () => {
  it("vaut toujours 1 point, quel que soit le weight stocké", () => {
    expect(getMaxPoints({ q: "a", input: "checkbox", weight: 1 })).toBe(1);
    expect(getMaxPoints({ q: "a", input: "checkbox", weight: 4 })).toBe(1);
    expect(getMaxPoints({ q: "a", input: "checkbox" })).toBe(1);
  });

  it("normalizeQuestions écrit weight = 1 et conserve input / section / hint", () => {
    const [q] = normalizeQuestions([
      { q: "Objet du mail", input: "checkbox", weight: 3, section: "Le mail", hint: "h" },
    ]);
    expect(q).toEqual({
      q: "Objet du mail",
      input: "checkbox",
      weight: 1,
      section: "Le mail",
      hint: "h",
    });
  });

  it("le total d'une grille mixte additionne 1 par case", () => {
    const grid: EvaluationCriterion[] = [
      { q: "a", input: "checkbox", weight: 1 },
      { q: "b", input: "checkbox", weight: 1 },
      { q: "c", input: "scale", weight: 5 },
      { q: "d", input: "problem_bank", weight: 8 },
    ];
    expect(getTotalMaxPoints(grid)).toBe(15);
  });

  it("critère sans input : barème inchangé", () => {
    expect(getMaxPoints({ q: "a", weight: 20 })).toBe(20);
    expect(getMaxPoints({ q: "a", weight: 3 })).toBe(3);
  });
});

describe("validateScores — saisies à cocher", () => {
  const grid: EvaluationCriterion[] = [
    { q: "Case", input: "checkbox", weight: 1 },
    { q: "Échelle", input: "scale", weight: 5 },
    { q: "Pistes", input: "problem_bank", weight: 8 },
    { q: "Libre", weight: 20 },
  ];

  it("case cochée = 1 et décochée = 0 sont acceptées", () => {
    expect(validateScores(grid, { "0": 1 })).toBeNull();
    expect(validateScores(grid, { "0": 0 })).toBeNull();
  });

  it("une case à 2 est refusée (au-dessus du barème)", () => {
    expect(validateScores(grid, { "0": 2 })?.reason).toBe("above_max");
  });

  it("une case, une échelle ou un compte de pistes à 0,5 sont refusés", () => {
    expect(validateScores(grid, { "0": 0.5 })?.reason).toBe("not_integer");
    expect(validateScores(grid, { "1": 2.5 })?.reason).toBe("not_integer");
    expect(validateScores(grid, { "2": 3.5 })?.reason).toBe("not_integer");
  });

  it("l'échelle accepte les entiers de 0 au barème", () => {
    for (let n = 0; n <= 5; n++) expect(validateScores(grid, { "1": n })).toBeNull();
    expect(validateScores(grid, { "1": 6 })?.reason).toBe("above_max");
  });

  it("un critère chiffré garde les demi-points", () => {
    expect(validateScores(grid, { "3": 12.5 })).toBeNull();
  });

  it("message français pour un entier attendu", () => {
    const err = validateScores(grid, { "1": 2.5 })!;
    expect(scoreValidationMessage(err)).toBe(
      'La note pour le critère "Échelle" doit être un nombre entier.',
    );
  });
});
