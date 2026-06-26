import { describe, it, expect } from "vitest";
import {
  pairKey,
  timeOverlaps,
  availabilityMatchesSlot,
  isFrozen,
  scoreMember,
} from "./dispatch-core";

describe("pairKey", () => {
  it("est indépendante de l'ordre des membres", () => {
    expect(pairKey("a", "b")).toBe(pairKey("b", "a"));
  });
});

describe("timeOverlaps", () => {
  it("détecte un chevauchement", () => {
    expect(timeOverlaps("12:00", "13:00", "12:05", "12:50")).toBe(true);
  });
  it("ne chevauche pas si adjacent (fin == début)", () => {
    expect(timeOverlaps("11:00", "11:20", "11:20", "11:40")).toBe(false);
  });
  it("ne chevauche pas si disjoint", () => {
    expect(timeOverlaps("09:00", "10:00", "11:00", "12:00")).toBe(false);
  });
});

describe("availabilityMatchesSlot", () => {
  const slot = { date: "2026-06-22", start_time: "12:05", end_time: "12:50" };

  it("matche une dispo qui englobe le créneau (group épreuve sous-staffée résolu)", () => {
    const av = { date: "2026-06-22", start_time: "12:00", end_time: "13:00" };
    expect(availabilityMatchesSlot(av, slot)).toBe(true);
  });

  it("ne matche pas un autre jour", () => {
    const av = { date: "2026-06-23", start_time: "12:00", end_time: "13:00" };
    expect(availabilityMatchesSlot(av, slot)).toBe(false);
  });

  it("ne matche pas une dispo disjointe le même jour", () => {
    const av = { date: "2026-06-22", start_time: "09:00", end_time: "10:00" };
    expect(availabilityMatchesSlot(av, slot)).toBe(false);
  });

  it("repli rétro-compatible sur l'égalité d'heure de début si pas de end_time", () => {
    expect(
      availabilityMatchesSlot(
        { date: "2026-06-22", start_time: "12:05" },
        slot,
      ),
    ).toBe(true);
    expect(
      availabilityMatchesSlot(
        { date: "2026-06-22", start_time: "12:00" },
        slot,
      ),
    ).toBe(false);
  });

  it("gère les timestamps ISO (substring date/heure)", () => {
    const av = {
      date: "2026-06-22T00:00:00.000Z",
      start_time: "12:00:00",
      end_time: "13:00:00",
    };
    expect(availabilityMatchesSlot(av, slot)).toBe(true);
  });
});

describe("isFrozen", () => {
  const now = new Date("2026-06-22T08:00:00");
  it("gèle un créneau à moins de 24h", () => {
    const slot = { date: "2026-06-22", start_time: "18:00", end_time: "18:20" };
    expect(isFrozen(slot, now)).toBe(true);
  });
  it("ne gèle pas un créneau à plus de 24h", () => {
    const slot = { date: "2026-06-24", start_time: "10:00", end_time: "10:20" };
    expect(isFrozen(slot, now)).toBe(false);
  });
});

describe("scoreMember (équité + brassage)", () => {
  it("privilégie le membre le moins chargé", () => {
    const load = { a: 0, b: 2 };
    const pairs = new Map<string, number>();
    expect(scoreMember("a", [], load, pairs)).toBeLessThan(
      scoreMember("b", [], load, pairs),
    );
  });

  it("pénalise un binôme récurrent (brassage)", () => {
    const load = { a: 1, b: 1, c: 1 };
    const pairs = new Map<string, number>([[pairKey("a", "x"), 3]]);
    // a déjà beaucoup tourné avec x → score plus élevé que c (jamais avec x)
    expect(scoreMember("a", ["x"], load, pairs)).toBeGreaterThan(
      scoreMember("c", ["x"], load, pairs),
    );
  });
});
