import { describe, it, expect } from "vitest";
import {
  candidateMatchesFilter,
  chunk,
  isCandidateFilter,
  startOfUtcDay,
  EMAIL_BATCH_SIZE,
} from "./announcements";

describe("candidateMatchesFilter", () => {
  const enLice = { tour1_status: "accepted", tour2_status: "pending", tour3_status: "pending" };
  const refuseT2 = { tour1_status: "accepted", tour2_status: "refused", tour3_status: "pending" };

  it("« tous » prend même les candidats sans délibération", () => {
    expect(candidateMatchesFilter("all", undefined)).toBe(true);
    expect(candidateMatchesFilter("all", refuseT2)).toBe(true);
  });

  it("« en lice » exclut tout candidat refusé à un tour quelconque", () => {
    expect(candidateMatchesFilter("en_lice", enLice)).toBe(true);
    expect(candidateMatchesFilter("en_lice", refuseT2)).toBe(false);
  });

  it("un candidat sans ligne de délibération est en lice, admis à aucun tour", () => {
    expect(candidateMatchesFilter("en_lice", null)).toBe(true);
    expect(candidateMatchesFilter("accepted_tour1", null)).toBe(false);
    expect(candidateMatchesFilter("refused", null)).toBe(false);
  });

  it("cible le bon tour pour les admis", () => {
    expect(candidateMatchesFilter("accepted_tour1", enLice)).toBe(true);
    expect(candidateMatchesFilter("accepted_tour2", enLice)).toBe(false);
    // Un refus au tour 2 n'efface pas l'admission au tour 1.
    expect(candidateMatchesFilter("accepted_tour1", refuseT2)).toBe(true);
  });

  it("« refusés » attrape un refus à n'importe quel tour", () => {
    expect(candidateMatchesFilter("refused", refuseT2)).toBe(true);
    expect(candidateMatchesFilter("refused", enLice)).toBe(false);
  });

  describe("« vœux non remplis »", () => {
    it("cible un admis T1 en lice qui n'a aucun vœu", () => {
      expect(candidateMatchesFilter("no_wishes", enLice, { hasWishes: false })).toBe(true);
      // Sans le 3e paramètre, on considère qu'il n'a pas de vœux (rétro-compat).
      expect(candidateMatchesFilter("no_wishes", enLice)).toBe(true);
    });

    it("exclut celui qui a déjà rempli ses vœux", () => {
      expect(candidateMatchesFilter("no_wishes", enLice, { hasWishes: true })).toBe(false);
    });

    it("exclut un refusé, même s'il a été admis au T1", () => {
      expect(candidateMatchesFilter("no_wishes", refuseT2, { hasWishes: false })).toBe(false);
    });

    it("exclut un candidat non admis au T1 (pending ou sans délibération)", () => {
      const pending = { tour1_status: "pending", tour2_status: null, tour3_status: null };
      expect(candidateMatchesFilter("no_wishes", pending, { hasWishes: false })).toBe(false);
      expect(candidateMatchesFilter("no_wishes", null, { hasWishes: false })).toBe(false);
    });

    it("le 3e paramètre n'altère pas les autres filtres", () => {
      expect(candidateMatchesFilter("en_lice", enLice, { hasWishes: true })).toBe(true);
      expect(candidateMatchesFilter("accepted_tour1", enLice, { hasWishes: true })).toBe(true);
    });
  });
});

describe("isCandidateFilter", () => {
  it("rejette une valeur inventée venue du client", () => {
    expect(isCandidateFilter("all")).toBe(true);
    expect(isCandidateFilter("tous")).toBe(false);
    expect(isCandidateFilter(null)).toBe(false);
  });
});

describe("chunk", () => {
  it("découpe en lots de 100 — la taille d'un batch Resend", () => {
    const lots = chunk(Array.from({ length: 122 }, (_, i) => i), EMAIL_BATCH_SIZE);
    expect(lots.map((l) => l.length)).toEqual([100, 22]);
  });

  it("ne produit aucun lot pour une liste vide", () => {
    expect(chunk([], 10)).toEqual([]);
  });
});

describe("startOfUtcDay", () => {
  it("ramène à minuit UTC, la fenêtre sur laquelle Resend compte le quota", () => {
    expect(startOfUtcDay(new Date("2026-09-13T22:45:00Z"))).toBe(
      "2026-09-13T00:00:00.000Z",
    );
  });
});
