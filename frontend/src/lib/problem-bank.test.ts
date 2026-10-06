import { describe, it, expect } from "vitest";
import {
  bankMatchesGrid,
  findProblemQuestion,
  normalizeProblemChecks,
  parseProblemBank,
  problemScore,
  scoreFromChecks,
} from "./problem-bank";

const BANK = {
  criterionIndex: 2,
  maxPoints: 8,
  questions: [
    { key: "a", title: "Question A", prompt: "Que faites-vous ?", pole: "RH", pistes: ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"] },
    { key: "b", title: "Question B", prompt: "Et là ?", pistes: ["q0", "q1"] },
  ],
};

const GRID = [
  { q: "Case", input: "checkbox", weight: 1 },
  { q: "Case 2", input: "checkbox", weight: 1 },
  { q: "Réponse à la problématique", input: "problem_bank", weight: 8 },
];

describe("parseProblemBank", () => {
  it("lit un objet ou une chaîne JSON", () => {
    expect(parseProblemBank(BANK)?.questions).toHaveLength(2);
    expect(parseProblemBank(JSON.stringify(BANK))?.criterionIndex).toBe(2);
  });

  it("null, vide ou illisible → null (comportement d'avant)", () => {
    expect(parseProblemBank(null)).toBeNull();
    expect(parseProblemBank(undefined)).toBeNull();
    expect(parseProblemBank("{")).toBeNull();
    expect(parseProblemBank({})).toBeNull();
    expect(parseProblemBank({ ...BANK, questions: [] })).toBeNull();
  });

  it("refuse un index de critère ou un barème invalides", () => {
    expect(parseProblemBank({ ...BANK, criterionIndex: -1 })).toBeNull();
    expect(parseProblemBank({ ...BANK, criterionIndex: 1.5 })).toBeNull();
    expect(parseProblemBank({ ...BANK, maxPoints: 0 })).toBeNull();
  });

  it("refuse des clés de question en double ou vides", () => {
    expect(
      parseProblemBank({ ...BANK, questions: [BANK.questions[0], BANK.questions[0]] }),
    ).toBeNull();
    expect(
      parseProblemBank({ ...BANK, questions: [{ ...BANK.questions[0], key: " " }] }),
    ).toBeNull();
  });

  it("ne garde que les pistes textuelles non vides", () => {
    const bank = parseProblemBank({
      ...BANK,
      questions: [{ key: "x", title: "X", prompt: "?", pistes: ["ok", "", 3, " bien "] }],
    });
    expect(bank?.questions[0].pistes).toEqual(["ok", "bien"]);
  });
});

describe("bankMatchesGrid", () => {
  it("vrai quand le critère visé est bien « problem_bank » au même barème", () => {
    expect(bankMatchesGrid(parseProblemBank(BANK)!, GRID)).toBe(true);
  });

  it("faux si l'index pointe ailleurs ou hors de la grille", () => {
    expect(bankMatchesGrid(parseProblemBank({ ...BANK, criterionIndex: 0 })!, GRID)).toBe(false);
    expect(bankMatchesGrid(parseProblemBank({ ...BANK, criterionIndex: 9 })!, GRID)).toBe(false);
  });

  it("faux si le barème du critère diffère de maxPoints", () => {
    expect(bankMatchesGrid(parseProblemBank({ ...BANK, maxPoints: 6 })!, GRID)).toBe(false);
  });
});

describe("problemScore", () => {
  it("1 point par piste, plafonné au barème", () => {
    expect(problemScore(0, 0, 8)).toBe(0);
    expect(problemScore(3, 0, 8)).toBe(3);
    expect(problemScore(3, 2, 8)).toBe(5);
    expect(problemScore(10, 0, 8)).toBe(8);
    expect(problemScore(7, 4, 8)).toBe(8);
  });

  it("valeurs négatives ou non entières ramenées à un entier positif", () => {
    expect(problemScore(-2, -1, 8)).toBe(0);
    expect(problemScore(2.7, 0, 8)).toBe(2);
  });
});

describe("normalizeProblemChecks / scoreFromChecks", () => {
  const bank = parseProblemBank(BANK)!;

  it("garde les pistes valides, sans doublon, triées", () => {
    expect(
      normalizeProblemChecks(bank, { questionKey: "a", checked: [3, 1, 3, 12, -1, 2.5, "4"], extra: 1 }),
    ).toEqual({ questionKey: "a", checked: [1, 3], extra: 1 });
  });

  it("question inconnue → null", () => {
    expect(normalizeProblemChecks(bank, { questionKey: "zz", checked: [0] })).toBeNull();
  });

  it("pistes « hors liste » bornées entre 0 et le barème", () => {
    expect(normalizeProblemChecks(bank, { questionKey: "b", checked: [], extra: 30 })?.extra).toBe(8);
    expect(normalizeProblemChecks(bank, { questionKey: "b", checked: [], extra: -3 })?.extra).toBe(0);
    expect(normalizeProblemChecks(bank, { questionKey: "b", checked: [] })?.extra).toBe(0);
  });

  it("le score découle des pistes cochées + hors liste, plafonné", () => {
    const checks = normalizeProblemChecks(bank, {
      questionKey: "a",
      checked: [0, 1, 2, 3, 4, 5, 6],
      extra: 3,
    })!;
    expect(scoreFromChecks(bank, checks)).toBe(8);
    expect(
      scoreFromChecks(bank, normalizeProblemChecks(bank, { questionKey: "b", checked: [0], extra: 1 })!),
    ).toBe(2);
  });

  it("findProblemQuestion retrouve une question par sa clé", () => {
    expect(findProblemQuestion(bank, "b")?.title).toBe("Question B");
    expect(findProblemQuestion(bank, "nope")).toBeNull();
  });
});
