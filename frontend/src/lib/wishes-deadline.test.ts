import { describe, it, expect } from "vitest";
import {
  WISHES_DEADLINE_SETTING_KEY,
  parseWishesDeadline,
  isWishesClosed,
  readWishesDeadline,
} from "./wishes-deadline";
import type { SettingReader } from "./enrollment-window";

/** Jeudi 15/10/2026 17:00 à Paris (heure d'été, +02:00) = 15:00 UTC. */
const DEADLINE_MS = Date.parse("2026-10-15T17:00:00+02:00");

describe("parseWishesDeadline", () => {
  it("lit une heure murale parisienne « AAAA-MM-JJ HH:MM » comme heure de Paris, pas du serveur", () => {
    expect(parseWishesDeadline("2026-10-15 17:00")).toBe(DEADLINE_MS);
    expect(parseWishesDeadline("2026-10-15T17:00")).toBe(DEADLINE_MS);
  });

  it("lit un instant ISO complet tel quel", () => {
    expect(parseWishesDeadline("2026-10-15T15:00:00.000Z")).toBe(DEADLINE_MS);
    expect(parseWishesDeadline("2026-10-15T17:00:00+02:00")).toBe(DEADLINE_MS);
  });

  it("ignore ce qu'il ne sait pas lire (aucune échéance → vœux ouverts)", () => {
    expect(parseWishesDeadline(null)).toBeNull();
    expect(parseWishesDeadline(undefined)).toBeNull();
    expect(parseWishesDeadline("")).toBeNull();
    expect(parseWishesDeadline("bientôt")).toBeNull();
    // Une date seule est ambiguë (minuit de quel fuseau ?) : on n'en déduit rien.
    expect(parseWishesDeadline("2026-10-15")).toBeNull();
  });
});

describe("isWishesClosed", () => {
  const value = "2026-10-15 17:00";

  it("reste ouvert jusqu'à l'échéance", () => {
    expect(isWishesClosed(value, new Date("2026-10-15T16:59:59+02:00"))).toBe(false);
    expect(isWishesClosed(value, new Date("2026-10-14T14:00:00+02:00"))).toBe(false);
  });

  it("ferme à l'échéance exacte et après", () => {
    expect(isWishesClosed(value, new Date("2026-10-15T17:00:00+02:00"))).toBe(true);
    expect(isWishesClosed(value, new Date("2026-10-16T09:00:00+02:00"))).toBe(true);
  });

  it("sans échéance lisible, ne ferme jamais", () => {
    expect(isWishesClosed(null)).toBe(false);
    expect(isWishesClosed("n'importe quoi")).toBe(false);
  });
});

describe("readWishesDeadline", () => {
  it("interroge la bonne clé et rend la valeur brute", async () => {
    let asked = "";
    const read: SettingReader = async (key) => {
      asked = key;
      return { data: { value: "2026-10-15 17:00" }, error: null };
    };
    expect(await readWishesDeadline(read)).toBe("2026-10-15 17:00");
    expect(asked).toBe(WISHES_DEADLINE_SETTING_KEY);
  });

  it("rend null si la ligne est absente, en erreur ou si la lecture plante", async () => {
    expect(
      await readWishesDeadline(async () => ({ data: null, error: null })),
    ).toBeNull();
    expect(
      await readWishesDeadline(async () => ({ data: null, error: new Error("x") })),
    ).toBeNull();
    expect(
      await readWishesDeadline(async () => {
        throw new Error("réseau");
      }),
    ).toBeNull();
  });
});
