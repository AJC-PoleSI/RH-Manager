import { describe, it, expect } from "vitest";
import { mergeExaminers, type ExaminerRef } from "./evaluation-examiners";

const marie: ExaminerRef = {
  id: "m1",
  firstName: "Marie",
  lastName: "Durand",
  email: "marie@ajc.fr",
};
const paul: ExaminerRef = {
  id: "m2",
  firstName: "Paul",
  lastName: "Martin",
  email: "paul@ajc.fr",
};

describe("mergeExaminers", () => {
  it("crédite les deux examinateurs inscrits, auteur en premier", () => {
    // Cas réel : Marie saisit la note du binôme, Paul ne s'est jamais
    // connecté — il est quand même crédité via evaluator_tracking.
    expect(mergeExaminers(marie, [marie, paul])).toEqual([marie, paul]);
  });

  it("ne compte pas l'auteur deux fois", () => {
    const merged = mergeExaminers(marie, [marie]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("m1");
  });

  it("retombe sur le seul auteur quand aucun suivi n'existe", () => {
    expect(mergeExaminers(marie, undefined)).toEqual([marie]);
    expect(mergeExaminers(marie, [])).toEqual([marie]);
  });

  it("garde les co-examinateurs même sans auteur connu", () => {
    expect(mergeExaminers(null, [paul])).toEqual([paul]);
  });

  it("ignore les entrées sans id", () => {
    const orphan = { id: "", firstName: "", lastName: "", email: "" };
    expect(mergeExaminers(marie, [orphan, paul])).toEqual([marie, paul]);
  });

  it("ne renvoie rien quand il n'y a ni auteur ni suivi", () => {
    expect(mergeExaminers(null, [])).toEqual([]);
  });
});
