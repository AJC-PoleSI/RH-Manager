import { describe, it, expect } from "vitest";
import { expectedCandidatesFor, eligibleMembersFor } from "./generation-inputs";

const delibs = [
  { candidate_id: "a", tour1_status: "accepted", tour2_status: "accepted" },
  { candidate_id: "b", tour1_status: "accepted", tour2_status: "pending" },
  { candidate_id: "c", tour1_status: "refused" },
  { candidate_id: "d", tour1_status: "accepted", tour2_status: "accepted" },
];
const wishes = [
  { candidate_id: "a", pole: "Developpement Commercial" },
  { candidate_id: "b", pole: "Développement commercial" },
  { candidate_id: "d", pole: "Marketing" },
];
const ids = ["a", "b", "c", "d", "e"];

describe("expectedCandidatesFor", () => {
  it("tour 1 : tout le monde sauf les refusés", () => {
    expect(
      expectedCandidatesFor({ tour: 1, isPoleTest: false, pole: null, candidateIds: ids, deliberations: delibs, wishes }),
    ).toEqual(["a", "b", "d", "e"]);
  });

  it("tour 3 : seulement les admis au tour 2", () => {
    expect(
      expectedCandidatesFor({ tour: 3, isPoleTest: false, pole: null, candidateIds: ids, deliberations: delibs, wishes }),
    ).toEqual(["a", "d"]);
  });

  it("épreuve de pôle : admis au tour précédent AVEC un vœu pour ce pôle (accents/casse ignorés)", () => {
    expect(
      expectedCandidatesFor({
        tour: 3,
        isPoleTest: true,
        pole: "Développement commercial",
        candidateIds: ids,
        deliberations: delibs,
        wishes,
      }),
    ).toEqual(["a"]); // b : pas admis T2 ; d : vœu Marketing
  });

  it("un candidat sans délibération n'est pas attendu après le tour 1", () => {
    expect(
      expectedCandidatesFor({ tour: 2, isPoleTest: false, pole: null, candidateIds: ["e"], deliberations: delibs, wishes }),
    ).toEqual([]);
  });
});

describe("eligibleMembersFor", () => {
  const members = [
    { id: "m1", pole: "Audit Qualité" },
    { id: "m2", pole: "audit qualite" },
    { id: "m3", pole: "Marketing" },
    { id: "m4", pole: null },
  ];

  it("épreuve de pôle : les membres du pôle, accents et casse ignorés", () => {
    expect(eligibleMembersFor({ isPoleTest: true, pole: "Audit Qualité", members })).toEqual(["m1", "m2"]);
  });

  it("épreuve ouverte à tous : tout le monde, même sans pôle", () => {
    expect(eligibleMembersFor({ isPoleTest: false, pole: null, members })).toEqual(["m1", "m2", "m3", "m4"]);
  });
});
