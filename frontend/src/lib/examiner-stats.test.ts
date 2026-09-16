import { describe, it, expect } from "vitest";
import {
  COEFFICIENT_MAX,
  computeExaminerStats,
  emptyExaminerStats,
  MIN_SCORES_FOR_CALIBRATION,
  tendencyLabel,
  type ExaminerEvaluationInput,
} from "./examiner-stats";

function ev(
  partial: Partial<ExaminerEvaluationInput> & { id: string },
): ExaminerEvaluationInput {
  return {
    examinerIds: ["felix"],
    epreuveKey: "bg",
    scoreOn20: 14,
    isCollective: false,
    ...partial,
  };
}

describe("décompte des évaluations", () => {
  it("compte un candidat évalué par avis individuel", () => {
    const stats = computeExaminerStats([
      ev({ id: "1" }),
      ev({ id: "2" }),
    ]);
    expect(stats.felix.evaluations).toBe(2);
  });

  it("crédite une note partagée à ses deux examinateurs", () => {
    const stats = computeExaminerStats([
      ev({ id: "1", examinerIds: ["felix", "lea"], epreuveKey: "entretien" }),
    ]);
    expect(stats.felix.evaluations).toBe(1);
    expect(stats.lea.evaluations).toBe(1);
  });

  it("ne compte pas les anciennes notes collectives comme des candidats évalués", () => {
    // Le cas signalé : 2 avis individuels + 2 notes collectives héritées du
    // business game affichaient « 4 évaluations ».
    const stats = computeExaminerStats([
      ev({ id: "1" }),
      ev({ id: "2" }),
      ev({ id: "3", isCollective: true, scoreOn20: 11 }),
      ev({ id: "4", isCollective: true, scoreOn20: 11 }),
    ]);
    expect(stats.felix.evaluations).toBe(2);
  });

  it("dénombre les notes collectives une seule fois par épreuve", () => {
    const stats = computeExaminerStats([
      ev({ id: "3", isCollective: true }),
      ev({ id: "4", isCollective: true }),
      ev({ id: "5", isCollective: true, epreuveKey: "bg-t3" }),
    ]);
    expect(stats.felix.collectiveNotes).toBe(2);
    expect(stats.felix.evaluations).toBe(0);
  });

  it("ne compte qu'une fois une évaluation présente en double dans l'entrée", () => {
    const stats = computeExaminerStats([
      ev({ id: "1", examinerIds: ["felix"] }),
      ev({ id: "1", examinerIds: ["lea"] }),
    ]);
    expect(stats.felix.evaluations).toBe(1);
    expect(stats.lea.evaluations).toBe(1);
  });

  it("ignore une grille vide dans les moyennes mais la compte comme évaluation", () => {
    const stats = computeExaminerStats([ev({ id: "1", scoreOn20: null })]);
    expect(stats.felix.evaluations).toBe(1);
    expect(stats.felix.scored).toBe(0);
    expect(stats.felix.average).toBeNull();
  });
});

describe("barème de l'examinateur", () => {
  const severe = [
    ev({ id: "s1", examinerIds: ["dur"], scoreOn20: 12 }),
    ev({ id: "s2", examinerIds: ["dur"], scoreOn20: 13 }),
    ev({ id: "s3", examinerIds: ["dur"], scoreOn20: 12 }),
  ];
  const genereux = [
    ev({ id: "g1", examinerIds: ["doux"], scoreOn20: 17 }),
    ev({ id: "g2", examinerIds: ["doux"], scoreOn20: 17 }),
    ev({ id: "g3", examinerIds: ["doux"], scoreOn20: 16 }),
  ];

  it("repère l'examinateur sévère et propose un coefficient > 1", () => {
    const stats = computeExaminerStats([...severe, ...genereux]);
    expect(stats.dur.average).toBeCloseTo(12.3, 1);
    expect(stats.dur.reference).toBeCloseTo(16.7, 1);
    expect(stats.dur.tendency).toBe("severe");
    expect(stats.dur.coefficient).toBeGreaterThan(1);
  });

  it("repère l'examinateur généreux et propose un coefficient < 1", () => {
    const stats = computeExaminerStats([...severe, ...genereux]);
    expect(stats.doux.tendency).toBe("genereux");
    expect(stats.doux.coefficient).toBeLessThan(1);
    expect(stats.doux.deviation).toBeGreaterThan(0);
  });

  it("borne le coefficient d'un écart extrême", () => {
    const stats = computeExaminerStats([
      ev({ id: "a", examinerIds: ["dur"], scoreOn20: 2 }),
      ev({ id: "b", examinerIds: ["dur"], scoreOn20: 2 }),
      ev({ id: "c", examinerIds: ["dur"], scoreOn20: 2 }),
      ev({ id: "d", examinerIds: ["doux"], scoreOn20: 19 }),
    ]);
    expect(stats.dur.coefficient).toBe(COEFFICIENT_MAX);
  });

  it("ne compare que les épreuves en commun", () => {
    // « dur » n'a noté que le business game : la moyenne de l'entretien, plus
    // haute, ne doit pas servir de référence.
    const stats = computeExaminerStats([
      ev({ id: "a", examinerIds: ["dur"], epreuveKey: "bg", scoreOn20: 12 }),
      ev({ id: "b", examinerIds: ["dur"], epreuveKey: "bg", scoreOn20: 12 }),
      ev({ id: "c", examinerIds: ["dur"], epreuveKey: "bg", scoreOn20: 12 }),
      ev({ id: "d", examinerIds: ["pair"], epreuveKey: "bg", scoreOn20: 14 }),
      ev({ id: "e", examinerIds: ["pair"], epreuveKey: "entretien", scoreOn20: 19 }),
    ]);
    expect(stats.dur.reference).toBe(14);
  });

  it("exclut ses propres notes de sa référence, y compris via son binôme", () => {
    // La note partagée porte la même valeur pour les deux examinateurs :
    // sans exclusion par évaluation, « felix » se comparerait à lui-même.
    const stats = computeExaminerStats([
      ev({ id: "a", examinerIds: ["felix", "lea"], scoreOn20: 10 }),
      ev({ id: "b", examinerIds: ["felix", "lea"], scoreOn20: 10 }),
      ev({ id: "c", examinerIds: ["felix", "lea"], scoreOn20: 10 }),
      ev({ id: "d", examinerIds: ["autre"], scoreOn20: 16 }),
    ]);
    expect(stats.felix.reference).toBe(16);
    expect(stats.felix.deviation).toBe(-6);
  });

  it("n'annonce pas de barème en dessous du minimum de notes", () => {
    const stats = computeExaminerStats([
      ev({ id: "a", examinerIds: ["dur"], scoreOn20: 10 }),
      ev({ id: "b", examinerIds: ["autre"], scoreOn20: 16 }),
    ]);
    expect(MIN_SCORES_FOR_CALIBRATION).toBe(3);
    expect(stats.dur.reliable).toBe(false);
    expect(stats.dur.deviation).toBe(-6); // calculé, mais à ne pas afficher
  });

  it("reste sans référence quand personne d'autre n'a noté l'épreuve", () => {
    const stats = computeExaminerStats([
      ev({ id: "a", scoreOn20: 15 }),
      ev({ id: "b", scoreOn20: 15 }),
      ev({ id: "c", scoreOn20: 15 }),
    ]);
    expect(stats.felix.reference).toBeNull();
    expect(stats.felix.coefficient).toBeNull();
    expect(stats.felix.reliable).toBe(false);
  });

  it("donne l'amplitude des notes (« il met toujours 17 »)", () => {
    const stats = computeExaminerStats([
      ev({ id: "a", scoreOn20: 17 }),
      ev({ id: "b", scoreOn20: 17 }),
      ev({ id: "c", scoreOn20: 17 }),
    ]);
    expect(stats.felix.min).toBe(17);
    expect(stats.felix.max).toBe(17);
    expect(stats.felix.spread).toBe(0);
  });

  it("écarte la note collective de la moyenne de l'examinateur", () => {
    const stats = computeExaminerStats([
      ev({ id: "a", scoreOn20: 16 }),
      ev({ id: "b", scoreOn20: 16 }),
      ev({ id: "c", isCollective: true, scoreOn20: 0 }),
    ]);
    expect(stats.felix.average).toBe(16);
    expect(stats.felix.scored).toBe(2);
  });
});

describe("garde-fous", () => {
  it("renvoie un objet vide sans évaluation", () => {
    expect(computeExaminerStats([])).toEqual({});
  });

  it("ignore une évaluation sans identifiant", () => {
    const stats = computeExaminerStats([
      { ...ev({ id: "1" }), id: "" },
    ]);
    expect(stats).toEqual({});
  });

  it("expose des statistiques neutres pour un examinateur sans note", () => {
    const empty = emptyExaminerStats();
    expect(empty.evaluations).toBe(0);
    expect(empty.coefficient).toBeNull();
  });

  it("traduit les tendances", () => {
    expect(tendencyLabel("severe")).toBe("sévère");
    expect(tendencyLabel("genereux")).toBe("généreux");
    expect(tendencyLabel("neutre")).toBe("dans la moyenne");
  });
});
