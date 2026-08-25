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
