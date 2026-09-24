import { describe, it, expect } from "vitest";
import {
  DEFAULT_REFUSAL_MESSAGE,
  officialEliminationTour,
  pickRefusalMessage,
  refusalMessageKey,
  candidateRefusalMessageKey,
  isRefusalMessageKey,
  refusedBeforeTourFilter,
} from "./elimination";

describe("officialEliminationTour", () => {
  it("est null sans refus", () => {
    expect(officialEliminationTour(null, { 1: "termine" })).toBeNull();
    expect(
      officialEliminationTour({ tour1_status: "accepted" }, { 1: "termine" }),
    ).toBeNull();
    expect(
      officialEliminationTour({ tour1_status: "waiting" }, { 1: "termine" }),
    ).toBeNull();
  });

  it("attend la clôture du tour : pas de refus visible pendant la délibération", () => {
    expect(
      officialEliminationTour(
        { tour1_status: "refused" },
        { 1: "en_cours", 2: "a_venir" },
      ),
    ).toBeNull();
  });

  it("est officiel une fois le tour clos", () => {
    expect(
      officialEliminationTour(
        { tour1_status: "refused" },
        { 1: "termine", 2: "en_cours" },
      ),
    ).toBe(1);
  });

  it("reste officiel si le tour est réouvert alors que le suivant a démarré", () => {
    expect(
      officialEliminationTour(
        { tour1_status: "refused" },
        { 1: "en_cours", 2: "en_cours" },
      ),
    ).toBe(1);
  });

  it("vaut aussi pour le dernier tour", () => {
    expect(
      officialEliminationTour(
        { tour1_status: "accepted", tour2_status: "accepted", tour3_status: "refused" },
        { 1: "termine", 2: "termine", 3: "termine" },
      ),
    ).toBe(3);
  });
});

describe("pickRefusalMessage", () => {
  it("préfère le message individualisé", () => {
    expect(pickRefusalMessage("Perso", "Commun")).toBe("Perso");
  });

  it("retombe sur le message commun", () => {
    expect(pickRefusalMessage(null, "Commun")).toBe("Commun");
    expect(pickRefusalMessage(undefined, "Commun")).toBe("Commun");
  });

  it("un message vide envoyé = texte par défaut de l'email", () => {
    expect(pickRefusalMessage("  ", "Commun")).toBe(DEFAULT_REFUSAL_MESSAGE);
    expect(pickRefusalMessage(null, "")).toBe(DEFAULT_REFUSAL_MESSAGE);
    expect(pickRefusalMessage(null, null)).toBe(DEFAULT_REFUSAL_MESSAGE);
  });
});

describe("clés de message", () => {
  it("sont toutes reconnues comme privées", () => {
    expect(isRefusalMessageKey(refusalMessageKey(1))).toBe(true);
    expect(isRefusalMessageKey(candidateRefusalMessageKey(2, "abc"))).toBe(true);
    expect(isRefusalMessageKey("rooms")).toBe(false);
  });
});

describe("refusedBeforeTourFilter", () => {
  it("personne n'est exclu du tour 1", () => {
    expect(refusedBeforeTourFilter(1)).toBeNull();
  });

  it("exclut les refusés des tours précédents", () => {
    expect(refusedBeforeTourFilter(2)).toBe("tour1_status.eq.refused");
    expect(refusedBeforeTourFilter(3)).toBe(
      "tour1_status.eq.refused,tour2_status.eq.refused",
    );
  });
});
