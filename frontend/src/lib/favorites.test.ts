import { describe, it, expect } from "vitest";
import {
  MAX_FAVORITES,
  isEliminated,
  eliminatedAtTour,
  countActiveFavorites,
  hasFavoriteQuotaLeft,
} from "./favorites";

describe("isEliminated", () => {
  it("est faux sans délibération", () => {
    expect(isEliminated(null)).toBe(false);
    expect(isEliminated(undefined)).toBe(false);
    expect(isEliminated({})).toBe(false);
  });

  it("est faux tant qu'aucun tour n'est refusé", () => {
    expect(
      isEliminated({
        tour1_status: "accepted",
        tour2_status: "waiting",
        tour3_status: "pending",
      }),
    ).toBe(false);
  });

  it("est vrai dès qu'un tour est refusé", () => {
    expect(isEliminated({ tour1_status: "refused" })).toBe(true);
    expect(isEliminated({ tour1_status: "accepted", tour3_status: "refused" })).toBe(
      true,
    );
  });

  it("ne confond pas « sous réserve » avec un refus", () => {
    expect(isEliminated({ tour2_status: "waiting" })).toBe(false);
  });
});

describe("eliminatedAtTour", () => {
  it("renvoie le premier tour refusé", () => {
    expect(
      eliminatedAtTour({ tour1_status: "accepted", tour2_status: "refused" }),
    ).toBe(2);
  });

  it("renvoie null pour un candidat encore en lice", () => {
    expect(eliminatedAtTour({ tour1_status: "accepted" })).toBeNull();
    expect(eliminatedAtTour(null)).toBeNull();
  });
});

describe("quota de coups de cœur", () => {
  it("compte les cœurs posés sur des candidats en lice", () => {
    expect(countActiveFavorites(["a", "b", "c"], new Set())).toBe(3);
  });

  it("rend les cœurs posés sur des candidats éliminés", () => {
    // La règle produit : un favori refusé ne doit pas immobiliser un cœur.
    expect(countActiveFavorites(["a", "b", "c"], new Set(["b", "c"]))).toBe(1);
  });

  it("laisse replacer un cœur libéré par une élimination", () => {
    const five = ["a", "b", "c", "d", "e"];
    expect(hasFavoriteQuotaLeft(five, new Set())).toBe(false);
    expect(hasFavoriteQuotaLeft(five, new Set(["a"]))).toBe(true);
  });

  it("bloque au-delà du quota", () => {
    const ids = Array.from({ length: MAX_FAVORITES }, (_, i) => `c${i}`);
    expect(countActiveFavorites(ids, new Set())).toBe(MAX_FAVORITES);
    expect(hasFavoriteQuotaLeft(ids, new Set())).toBe(false);
  });

  it("part d'un quota plein pour un membre sans cœur", () => {
    expect(hasFavoriteQuotaLeft([], new Set())).toBe(true);
    expect(countActiveFavorites([], new Set())).toBe(0);
  });
});
