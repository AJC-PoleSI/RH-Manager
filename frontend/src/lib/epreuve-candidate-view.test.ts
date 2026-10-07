import { describe, it, expect } from "vitest";
import {
  CANDIDATE_HIDDEN_EPREUVE_FIELDS,
  candidateSeesDescription,
  enrolledEpreuveIds,
  epreuveForCandidate,
  isOnTableEpreuve,
} from "./epreuve-candidate-view";

// Énoncé réservé aux inscrits (Felix, 07/10/2026 : « réserve l'énoncé aux
// inscrits »).
describe("candidateSeesDescription", () => {
  it("planning fermé → jamais, même inscrit", () => {
    expect(
      candidateSeesDescription({ planningVisible: false, onTable: false, enrolled: true }),
    ).toBe(false);
    expect(
      candidateSeesDescription({ planningVisible: false, onTable: true, enrolled: false }),
    ).toBe(false);
  });

  it("pas inscrit → masqué, même si des créneaux sont publiés", () => {
    expect(
      candidateSeesDescription({ planningVisible: true, onTable: false, enrolled: false }),
    ).toBe(false);
  });

  it("inscrit (créneau ou distanciel) → visible", () => {
    expect(
      candidateSeesDescription({ planningVisible: true, onTable: false, enrolled: true }),
    ).toBe(true);
  });

  it("épreuve sur table (aucune inscription possible) → visible à l'ouverture du planning", () => {
    expect(
      candidateSeesDescription({ planningVisible: true, onTable: true, enrolled: false }),
    ).toBe(true);
  });
});

describe("isOnTableEpreuve", () => {
  it("type commune, en camelCase comme en snake_case", () => {
    expect(isOnTableEpreuve({ isCommune: true })).toBe(true);
    expect(isOnTableEpreuve({ type: "commune" })).toBe(true);
  });

  it("distanciel, individuelle, groupe ou absente → non", () => {
    expect(isOnTableEpreuve({ isDistanciel: true })).toBe(false);
    expect(isOnTableEpreuve({ is_distanciel: true, type: "pole" })).toBe(false);
    expect(isOnTableEpreuve({ type: "groupe" })).toBe(false);
    expect(isOnTableEpreuve(null)).toBe(false);
  });
});

describe("enrolledEpreuveIds", () => {
  it("créneaux à inscription active + inscriptions en distanciel", () => {
    const ids = enrolledEpreuveIds(
      [
        { status: "active", epreuveId: "si" },
        { status: "enrolled", epreuveId: "bg" },
        { status: null, epreuveId: "aq" }, // ligne ancienne sans statut = active
      ],
      [{ epreuveId: "marketing" }],
    );
    expect(Array.from(ids).sort()).toEqual(["aq", "bg", "marketing", "si"]);
  });

  it("inscription annulée ou créneau sans épreuve → ignorés", () => {
    const ids = enrolledEpreuveIds(
      [
        { status: "cancelled", epreuveId: "si" },
        { status: "active", epreuveId: null },
      ],
      [{ epreuveId: null }],
    );
    expect(ids.size).toBe(0);
  });
});

// Épreuve telle que la met en forme GET /api/epreuves (camelCase).
const camel = {
  id: "ep-1",
  name: "Épreuve de prospection",
  tour: 3,
  type: "pole",
  coefficient: 2,
  isDistanciel: false,
  isRegistered: true,
  color: "#3B82F6",
  description: "Appelez le prospect et décrochez un rendez-vous.",
  evaluationQuestions: [{ id: "q1", label: "Accroche", max: 4 }],
  secondaryGrid: { criteria: [{ id: "s1", label: "Propale" }] },
  problemBank: [{ question: "Objection prix", answer: "Valeur" }],
  groupGrid: [{ id: "g1", label: "Coopération" }],
};

// Ligne brute jointe par `epreuve:epreuves(*)` (snake_case).
const snake = {
  id: "ep-2",
  name: "Business game",
  tour: 2,
  type: "groupe",
  coefficient: 1,
  is_distanciel: true,
  salle: "250",
  description: "Consignes du business game.",
  evaluation_questions: '[{"id":"q1","label":"Leadership","max":5}]',
  secondary_grid: null,
  problem_bank: '[{"question":"Q","answer":"R"}]',
  group_grid: '[{"id":"g1"}]',
};

function expectNoGrid(view: Record<string, any>) {
  for (const field of CANDIDATE_HIDDEN_EPREUVE_FIELDS) {
    expect(view).not.toHaveProperty(field);
  }
}

describe("CANDIDATE_HIDDEN_EPREUVE_FIELDS", () => {
  it("couvre les quatre grilles en camelCase ET en snake_case", () => {
    expect([...CANDIDATE_HIDDEN_EPREUVE_FIELDS].sort()).toEqual(
      [
        "evaluationQuestions",
        "evaluation_questions",
        "secondaryGrid",
        "secondary_grid",
        "problemBank",
        "problem_bank",
        "groupGrid",
        "group_grid",
      ].sort(),
    );
  });
});

describe("epreuveForCandidate", () => {
  it("planning fermé → description null et aucun champ de grille (camelCase)", () => {
    const view = epreuveForCandidate(camel, false);
    expect(view.description).toBeNull();
    expectNoGrid(view);
  });

  it("planning ouvert → description gardée, toujours aucun champ de grille (camelCase)", () => {
    const view = epreuveForCandidate(camel, true);
    expect(view.description).toBe(camel.description);
    expectNoGrid(view);
  });

  it("ligne brute snake_case : grilles retirées, description selon le planning", () => {
    const closed = epreuveForCandidate(snake, false);
    expect(closed.description).toBeNull();
    expectNoGrid(closed);

    const open = epreuveForCandidate(snake, true);
    expect(open.description).toBe(snake.description);
    expectNoGrid(open);
  });

  it("les autres champs passent inchangés", () => {
    const view = epreuveForCandidate(camel, true);
    expect(view).toEqual({
      id: "ep-1",
      name: "Épreuve de prospection",
      tour: 3,
      type: "pole",
      coefficient: 2,
      isDistanciel: false,
      isRegistered: true,
      color: "#3B82F6",
      description: camel.description,
    });

    const raw = epreuveForCandidate(snake, false);
    expect(raw).toEqual({
      id: "ep-2",
      name: "Business game",
      tour: 2,
      type: "groupe",
      coefficient: 1,
      is_distanciel: true,
      salle: "250",
      description: null,
    });
  });

  it("renvoie une copie : l'objet d'origine (vue membre) n'est pas modifié", () => {
    const original = { ...camel };
    epreuveForCandidate(original, false);
    expect(original).toEqual(camel);
  });

  it("ne crée pas de clé description si la jointure ne la portait pas", () => {
    const view = epreuveForCandidate({ id: "ep-3", name: "CL" }, false);
    expect(view).toEqual({ id: "ep-3", name: "CL" });
  });

  it("null / undefined (jointure vide) → renvoyés tels quels", () => {
    expect(epreuveForCandidate(null, false)).toBeNull();
    expect(epreuveForCandidate(undefined, true)).toBeUndefined();
  });
});
