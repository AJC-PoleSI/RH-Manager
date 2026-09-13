import { describe, it, expect } from "vitest";
import {
  pendingEpreuves,
  underfilledEnrollments,
  type SignupSlot,
} from "./candidate-signup-status";

const slot = (over: Partial<SignupSlot> & { id: string }): SignupSlot => ({
  date: "2026-09-21",
  startTime: "10:00",
  endTime: "10:20",
  isFull: false,
  isEnrolled: false,
  sessionEnrolled: 0,
  minCandidates: null,
  missingCandidates: 0,
  epreuve: { id: "ep1", name: "Entretien individuel", tour: 1 },
  ...over,
});

describe("pendingEpreuves", () => {
  it("signale une épreuve sans aucune inscription et compte les créneaux libres", () => {
    expect(pendingEpreuves([slot({ id: "a" }), slot({ id: "b" })])).toEqual([
      { epreuveId: "ep1", name: "Entretien individuel", tour: 1, freeSlots: 2 },
    ]);
  });

  it("ne signale plus l'épreuve dès qu'un créneau est réservé", () => {
    expect(
      pendingEpreuves([slot({ id: "a", isEnrolled: true }), slot({ id: "b" })]),
    ).toEqual([]);
  });

  it("ne compte pas les créneaux complets dans les places restantes", () => {
    const res = pendingEpreuves([
      slot({ id: "a", isFull: true }),
      slot({ id: "b" }),
    ]);
    expect(res[0].freeSlots).toBe(1);
  });

  it("signale l'épreuve même quand plus rien n'est réservable", () => {
    const res = pendingEpreuves([slot({ id: "a", isFull: true })]);
    expect(res).toEqual([
      { epreuveId: "ep1", name: "Entretien individuel", tour: 1, freeSlots: 0 },
    ]);
  });

  it("trie par tour puis par nom", () => {
    const res = pendingEpreuves([
      slot({ id: "a", epreuve: { id: "ep3", name: "Zèbre", tour: 1 } }),
      slot({ id: "b", epreuve: { id: "ep2", name: "Business Game", tour: 3 } }),
      slot({ id: "c", epreuve: { id: "ep1", name: "Alpha", tour: 1 } }),
    ]);
    expect(res.map((e) => e.name)).toEqual(["Alpha", "Zèbre", "Business Game"]);
  });
});

describe("underfilledEnrollments", () => {
  const bg = (over: Partial<SignupSlot>) =>
    slot({
      id: "bg1",
      isEnrolled: true,
      minCandidates: 5,
      epreuve: { id: "ep9", name: "Business Game", tour: 1 },
      ...over,
    });

  it("repère le candidat seul sur sa session", () => {
    expect(
      underfilledEnrollments([bg({ sessionEnrolled: 1, missingCandidates: 4 })]),
    ).toEqual([
      {
        slotId: "bg1",
        name: "Business Game",
        date: "2026-09-21",
        startTime: "10:00",
        sessionEnrolled: 1,
        missingCandidates: 4,
        alone: true,
      },
    ]);
  });

  it("signale aussi une session entamée à plusieurs mais incomplète", () => {
    const res = underfilledEnrollments([
      bg({ sessionEnrolled: 3, missingCandidates: 2 }),
    ]);
    expect(res[0].alone).toBe(false);
    expect(res[0].missingCandidates).toBe(2);
  });

  it("ignore une session au complet", () => {
    expect(
      underfilledEnrollments([bg({ sessionEnrolled: 5, missingCandidates: 0 })]),
    ).toEqual([]);
  });

  it("ignore un entretien individuel, où être seul est normal", () => {
    expect(
      underfilledEnrollments([
        slot({ id: "e1", isEnrolled: true, sessionEnrolled: 1 }),
      ]),
    ).toEqual([]);
  });

  it("ignore les créneaux où le candidat n'est pas inscrit", () => {
    expect(
      underfilledEnrollments([bg({ isEnrolled: false, missingCandidates: 4 })]),
    ).toEqual([]);
  });
});
