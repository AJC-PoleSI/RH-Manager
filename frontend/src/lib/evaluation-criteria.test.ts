import { describe, it, expect } from "vitest";
import {
  DEFAULT_MAX_POINTS,
  getCriterionLabel,
  getMaxPoints,
  getTotalMaxPoints,
  normalizeQuestions,
  parseQuestions,
} from "./evaluation-criteria";

// Régression de l'audit du 25 août 2026 : le formulaire d'administration
// appelait `weight` un « coefficient » et l'initialisait à 1, alors que
// l'API l'interprète comme le nombre de points MAXIMUM. Toute épreuve créée
// avec les valeurs par défaut refusait les notes supérieures à 1 point.

describe("getMaxPoints", () => {
  it("lit le barème déclaré", () => {
    expect(getMaxPoints({ q: "Motivation", weight: 20 })).toBe(20);
    expect(getMaxPoints({ q: "Ponctualité", weight: 5 })).toBe(5);
  });

  it("accepte les alias maxScore et coefficient", () => {
    expect(getMaxPoints({ maxScore: 10 })).toBe(10);
    expect(getMaxPoints({ coefficient: 15 })).toBe(15);
  });

  it("accepte les barèmes envoyés en chaîne", () => {
    expect(getMaxPoints({ weight: "12" })).toBe(12);
  });

  it("retombe sur le barème par défaut quand rien n'est déclaré", () => {
    expect(getMaxPoints({ q: "Sans barème" })).toBe(DEFAULT_MAX_POINTS);
    expect(getMaxPoints(null)).toBe(DEFAULT_MAX_POINTS);
    expect(getMaxPoints(undefined)).toBe(DEFAULT_MAX_POINTS);
  });

  it("refuse les barèmes nuls ou négatifs, qui rendraient l'épreuve innotable", () => {
    expect(getMaxPoints({ weight: 0 })).toBe(DEFAULT_MAX_POINTS);
    expect(getMaxPoints({ weight: -5 })).toBe(DEFAULT_MAX_POINTS);
    expect(getMaxPoints({ weight: "abc" })).toBe(DEFAULT_MAX_POINTS);
  });

  it("conserve un barème de 1 posé explicitement", () => {
    // 1 reste une valeur légitime (critère binaire) — ce qui était cassé,
    // c'est qu'elle arrivait par DÉFAUT, pas qu'elle soit interdite.
    expect(getMaxPoints({ weight: 1 })).toBe(1);
  });
});

describe("parseQuestions", () => {
  it("accepte une chaîne JSON comme un tableau déjà désérialisé", () => {
    const attendu = [{ q: "A", weight: 20 }];
    expect(parseQuestions(JSON.stringify(attendu))).toEqual(attendu);
    expect(parseQuestions(attendu)).toEqual(attendu);
  });

  it("renvoie un tableau vide sur une entrée illisible", () => {
    expect(parseQuestions("{pas du json")).toEqual([]);
    expect(parseQuestions(null)).toEqual([]);
    expect(parseQuestions(42)).toEqual([]);
  });
});

describe("normalizeQuestions", () => {
  it("force un barème exploitable sur chaque critère avant écriture en base", () => {
    const normalisé = normalizeQuestions([
      { q: "Déclaré", weight: 15 },
      { q: "Absent" },
      { q: "Nul", weight: 0 },
    ]);
    expect(normalisé.map((q) => q.weight)).toEqual([
      15,
      DEFAULT_MAX_POINTS,
      DEFAULT_MAX_POINTS,
    ]);
  });

  it("préserve les autres champs du critère", () => {
    const [q] = normalizeQuestions([{ q: "Motivation", weight: 0 }]);
    expect(q.q).toBe("Motivation");
  });
});

describe("getTotalMaxPoints", () => {
  it("somme les barèmes de tous les critères", () => {
    expect(getTotalMaxPoints([{ weight: 20 }, { weight: 20 }, { weight: 10 }])).toBe(50);
  });

  it("compte le barème par défaut pour les critères sans valeur", () => {
    expect(getTotalMaxPoints([{ q: "A" }, { q: "B" }])).toBe(DEFAULT_MAX_POINTS * 2);
  });

  it("vaut 0 sans critère — le client doit alors refuser de normaliser", () => {
    expect(getTotalMaxPoints([])).toBe(0);
    expect(getTotalMaxPoints(null)).toBe(0);
  });
});

describe("getCriterionLabel", () => {
  it("accepte les trois conventions de nommage rencontrées en base", () => {
    expect(getCriterionLabel({ q: "Depuis q" })).toBe("Depuis q");
    expect(getCriterionLabel({ question: "Depuis question" })).toBe("Depuis question");
    expect(getCriterionLabel({ name: "Depuis name" })).toBe("Depuis name");
    expect(getCriterionLabel(null)).toBe("");
  });
});

// La moyenne de délibération normalise chaque note par le barème de son
// épreuve, puis moyenne par épreuve avant de moyenner entre épreuves. Sans
// cela, un 5/5 et un 5/20 pesaient identiquement, et une épreuve notée par
// deux examinateurs comptait double.
describe("moyenne normalisée (logique de la page délibérations)", () => {
  function moyenneSur20(
    evaluations: { scores: Record<string, number>; epreuveId: string; maxTotal: number }[],
  ): number {
    const parEpreuve = new Map<string, number[]>();
    for (const ev of evaluations) {
      if (!ev.maxTotal || ev.maxTotal <= 0) continue;
      const obtenu = Object.values(ev.scores).reduce((a, b) => a + b, 0);
      const ratios = parEpreuve.get(ev.epreuveId) || [];
      ratios.push(obtenu / ev.maxTotal);
      parEpreuve.set(ev.epreuveId, ratios);
    }
    if (parEpreuve.size === 0) return 0;
    const parEp: number[] = [];
    parEpreuve.forEach((r) => parEp.push(r.reduce((a, b) => a + b, 0) / r.length));
    const global = parEp.reduce((a, b) => a + b, 0) / parEp.length;
    return Math.round(global * 20 * 10) / 10;
  }

  it("distingue un 5/5 d'un 5/20", () => {
    // L'ancien calcul (moyenne des notes brutes) renvoyait 5 dans les deux cas.
    expect(
      moyenneSur20([
        { scores: { 0: 5 }, epreuveId: "sur5", maxTotal: 5 },
        { scores: { 0: 5 }, epreuveId: "sur20", maxTotal: 20 },
      ]),
    ).toBe(12.5); // (100 % + 25 %) / 2 → 12,5/20
  });

  it("ne fait pas compter double une épreuve notée par deux examinateurs", () => {
    const deuxExaminateurs = moyenneSur20([
      { scores: { 0: 20 }, epreuveId: "A", maxTotal: 20 },
      { scores: { 0: 20 }, epreuveId: "A", maxTotal: 20 },
      { scores: { 0: 10 }, epreuveId: "B", maxTotal: 20 },
    ]);
    const unExaminateur = moyenneSur20([
      { scores: { 0: 20 }, epreuveId: "A", maxTotal: 20 },
      { scores: { 0: 10 }, epreuveId: "B", maxTotal: 20 },
    ]);
    expect(deuxExaminateurs).toBe(unExaminateur);
    expect(deuxExaminateurs).toBe(15);
  });

  it("ignore les évaluations sans barème connu plutôt que de fausser la moyenne", () => {
    expect(
      moyenneSur20([
        { scores: { 0: 18 }, epreuveId: "A", maxTotal: 20 },
        { scores: { 0: 999 }, epreuveId: "B", maxTotal: 0 },
      ]),
    ).toBe(18);
  });

  it("vaut 0 quand aucune évaluation n'est exploitable", () => {
    expect(moyenneSur20([])).toBe(0);
  });
});

// ── Validation des notes saisies (partagée POST / PUT /api/evaluations) ──
//
// Audit du 12/09/2026 : PUT /api/evaluations/[id] réécrivait les notes sans
// jamais les borner au barème (seul le POST le faisait, en ligne). Un
// examinateur pouvait donc corriger une note à 999/3 après coup.
import { normalizeScores, validateScores } from "./evaluation-criteria";

const QUESTIONS = [
  { q: "Tenue", weight: 3 },
  { q: "Fond", weight: 5 },
  { q: "Sans barème" }, // → DEFAULT_MAX_POINTS
];

describe("validateScores", () => {
  it("accepte des notes dans les bornes de chaque critère", () => {
    expect(validateScores(QUESTIONS, { "0": 3, "1": 0, "2": 20 })).toBeNull();
    expect(validateScores(QUESTIONS, { "0": "2.5" })).toBeNull();
  });

  it("refuse une note au-dessus du barème du critère, avec son libellé", () => {
    const err = validateScores(QUESTIONS, { "0": 2, "1": 6 });
    expect(err).toEqual({
      index: 1,
      label: "Fond",
      maxPoints: 5,
      reason: "above_max",
    });
  });

  it("refuse une note négative", () => {
    const err = validateScores(QUESTIONS, { "0": -1 });
    expect(err?.reason).toBe("negative");
    expect(err?.label).toBe("Tenue");
  });

  it("applique le barème par défaut à un critère sans barème", () => {
    expect(validateScores(QUESTIONS, { "2": 20 })).toBeNull();
    expect(validateScores(QUESTIONS, { "2": 21 })?.reason).toBe("above_max");
  });

  it("ignore les clés qui ne correspondent à aucun critère et les valeurs vides", () => {
    // Une clé hors barème (critère supprimé entre-temps) ou une case laissée
    // vide par l'examinateur ne doit pas bloquer la saisie : elle est
    // simplement écartée à la normalisation.
    expect(validateScores(QUESTIONS, { "7": 999, "0": "" })).toBeNull();
  });

  it("accepte les notes envoyées sous forme de chaîne JSON", () => {
    expect(validateScores(QUESTIONS, JSON.stringify({ "1": 5 }))).toBeNull();
    expect(validateScores(QUESTIONS, JSON.stringify({ "1": 5.5 }))?.reason).toBe(
      "above_max",
    );
  });

  it("sans critères déclarés, ne bloque rien (épreuve pas encore configurée)", () => {
    expect(validateScores([], { "0": 15 })).toBeNull();
  });
});

describe("normalizeScores", () => {
  it("stocke toujours des nombres (jamais '1' + '1' = '11')", () => {
    expect(normalizeScores({ "0": "3", "1": 2 })).toEqual({ "0": 3, "1": 2 });
  });

  it("accepte une chaîne JSON ou un objet, et tolère l'absence", () => {
    expect(normalizeScores(JSON.stringify({ "0": 1 }))).toEqual({ "0": 1 });
    expect(normalizeScores(undefined)).toEqual({});
    expect(normalizeScores(null)).toEqual({});
    expect(normalizeScores("{pas du json")).toEqual({});
  });

  it("écarte les valeurs non numériques ou vides au lieu de les stocker à 0", () => {
    // Une case laissée vide n'est pas une note de 0 : la stocker à 0 ferait
    // baisser la moyenne du candidat sans que personne ne l'ait décidé.
    expect(normalizeScores({ "0": "", "1": "abc", "2": 4 })).toEqual({ "2": 4 });
  });

  it("écarte les clés hors barème quand les critères sont fournis", () => {
    expect(normalizeScores({ "0": 1, "5": 9 }, QUESTIONS)).toEqual({ "0": 1 });
    expect(normalizeScores({ "0": 1, "5": 9 })).toEqual({ "0": 1, "5": 9 });
  });
});

// ── Moyenne pondérée unique (délibération, fiche candidat, export xlsx) ──
import { averageOn20ByEpreuve, hasAnyScore } from "./evaluation-criteria";

describe("hasAnyScore", () => {
  it("vrai dès qu'une note numérique existe", () => {
    expect(hasAnyScore({ "0": 3 })).toBe(true);
    expect(hasAnyScore('{"1":"4"}')).toBe(true);
    expect(hasAnyScore({ "0": 0 })).toBe(true); // un 0 saisi est une note
  });

  it("faux pour une évaluation vide ou sans valeur exploitable", () => {
    // Une note collective créée « à vide » (panneau jamais touché) ne doit pas
    // peser 0/40 dans la moyenne du candidat.
    expect(hasAnyScore({})).toBe(false);
    expect(hasAnyScore("{}")).toBe(false);
    expect(hasAnyScore(null)).toBe(false);
    expect(hasAnyScore({ "0": "", "1": "abc" })).toBe(false);
  });
});

describe("averageOn20ByEpreuve", () => {
  it("ramène chaque note en % de son barème avant de moyenner", () => {
    // 32/40 (80 %) et 4/5 (80 %) → 16/20, quel que soit le barème.
    expect(
      averageOn20ByEpreuve([
        { epreuveKey: "A", obtained: 32, maxTotal: 40 },
        { epreuveKey: "B", obtained: 4, maxTotal: 5 },
      ]),
    ).toBe(16);
  });

  it("moyenne d'abord les notes d'une même épreuve (deux examinateurs ≠ double poids)", () => {
    // Épreuve A notée 2 fois (20/20 et 10/20 → 15/20), épreuve B 10/20.
    // Sans regroupement : (20+10+10)/3 = 13,3 ; avec : (15+10)/2 = 12,5.
    expect(
      averageOn20ByEpreuve([
        { epreuveKey: "A", obtained: 20, maxTotal: 20 },
        { epreuveKey: "A", obtained: 10, maxTotal: 20 },
        { epreuveKey: "B", obtained: 10, maxTotal: 20 },
      ]),
    ).toBe(12.5);
  });

  it("pondère chaque épreuve par son barème (coef = barème / 20)", () => {
    // A /40 (coef 2) à 100 %, B /20 (coef 1) à 0 % → (2×1 + 1×0)/3 = 13,3.
    expect(
      averageOn20ByEpreuve([
        { epreuveKey: "A", obtained: 40, maxTotal: 40 },
        { epreuveKey: "B", obtained: 0, maxTotal: 20 },
      ]),
    ).toBe(13.3);
  });

  it("ignore les barèmes inconnus et renvoie null sans note exploitable", () => {
    expect(averageOn20ByEpreuve([])).toBeNull();
    expect(
      averageOn20ByEpreuve([{ epreuveKey: "A", obtained: 5, maxTotal: 0 }]),
    ).toBeNull();
    expect(
      averageOn20ByEpreuve([
        { epreuveKey: "A", obtained: 5, maxTotal: 0 },
        { epreuveKey: "B", obtained: 10, maxTotal: 20 },
      ]),
    ).toBe(10);
  });

  it("distingue une vraie moyenne de 0 d'une absence de note", () => {
    expect(
      averageOn20ByEpreuve([{ epreuveKey: "A", obtained: 0, maxTotal: 20 }]),
    ).toBe(0);
  });

  it("plafonne une note qui dépasserait son barème (données anciennes)", () => {
    expect(
      averageOn20ByEpreuve([{ epreuveKey: "A", obtained: 30, maxTotal: 20 }]),
    ).toBe(20);
  });
});
