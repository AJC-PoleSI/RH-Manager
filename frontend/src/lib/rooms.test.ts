import { describe, it, expect } from "vitest";
import {
  DEFAULT_ROOMS,
  normalizeRoomList,
  parseRoomList,
  renameInList,
  serializeRoomList,
  validateRoomName,
} from "./rooms";

describe("parseRoomList", () => {
  it("lit la liste stockée en texte, sans blancs ni doublons", () => {
    expect(parseRoomList(" 205, 217 ,,205,A12 ")).toEqual(["205", "217", "A12"]);
  });

  it("renvoie null pour une liste jamais enregistrée", () => {
    expect(parseRoomList(undefined)).toBeNull();
    expect(parseRoomList("  ,  ")).toBeNull();
  });

  it("relit ce que serializeRoomList écrit", () => {
    expect(parseRoomList(serializeRoomList(DEFAULT_ROOMS))).toEqual(DEFAULT_ROOMS);
  });
});

describe("validateRoomName", () => {
  it("refuse un nom vide, avec virgule ou trop long", () => {
    expect(validateRoomName("  ")).toMatch(/vide/);
    expect(validateRoomName("A,B")).toMatch(/virgule/);
    expect(validateRoomName("x".repeat(41))).toMatch(/40/);
    expect(validateRoomName(12)).toMatch(/vide/);
  });

  it("accepte un nom ordinaire", () => {
    expect(validateRoomName("Amphi B")).toBeNull();
  });
});

describe("normalizeRoomList", () => {
  it("nettoie les noms", () => {
    expect(normalizeRoomList([" 205 ", "Amphi B"])).toEqual({ rooms: ["205", "Amphi B"] });
  });

  it("refuse un doublon, même à la casse près", () => {
    expect(normalizeRoomList(["a12", "A12"])).toEqual({
      error: "La salle « A12 » apparaît deux fois.",
    });
  });

  it("refuse une liste vide ou qui n'en est pas une", () => {
    expect(normalizeRoomList([])).toHaveProperty("error");
    expect(normalizeRoomList("205")).toHaveProperty("error");
  });
});

describe("renameInList", () => {
  it("renomme à la même place", () => {
    expect(renameInList(["205", "217", "219"], "217", "310")).toEqual(["205", "310", "219"]);
  });

  it("ajoute le nouveau nom si l'ancien n'était pas déclaré", () => {
    expect(renameInList(["205"], "999", "310")).toEqual(["205", "310"]);
  });
});
