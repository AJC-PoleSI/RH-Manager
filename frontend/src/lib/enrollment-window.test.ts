import { describe, it, expect } from "vitest";
import {
  checkEnrollmentWindow,
  isLastMinuteWaived,
  readLastMinuteWaiveUntil,
  LAST_MINUTE_SETTING_KEY,
  type SettingsClient,
} from "./enrollment-window";

/** Dimanche 13/09/2026 15:44 — l'instant qui a motivé le réglage. */
const DIMANCHE = new Date("2026-09-13T15:44:00");

describe("checkEnrollmentWindow — règle des 24h (sans exception)", () => {
  it("refuse un créneau du lendemain matin (moins de 24h)", () => {
    const v = checkEnrollmentWindow({
      date: "2026-09-14",
      startTime: "09:00",
      now: DIMANCHE,
    });
    expect(v).toEqual({ allowed: false, reason: "notice" });
  });

  it("accepte un créneau à plus de 24h", () => {
    const v = checkEnrollmentWindow({
      date: "2026-09-15",
      startTime: "09:00",
      now: DIMANCHE,
    });
    expect(v).toEqual({ allowed: true });
  });

  it("accepte pile à 24h", () => {
    const v = checkEnrollmentWindow({
      date: "2026-09-14",
      startTime: "15:44",
      now: DIMANCHE,
    });
    expect(v).toEqual({ allowed: true });
  });

  it("réglage vide ou absent → règle des 24h (fail-closed)", () => {
    for (const waiveUntil of [null, undefined, "", "n'importe quoi"]) {
      expect(
        checkEnrollmentWindow({
          date: "2026-09-14",
          startTime: "09:00",
          waiveUntil,
          now: DIMANCHE,
        }),
      ).toEqual({ allowed: false, reason: "notice" });
    }
  });
});

describe("checkEnrollmentWindow — exception datée", () => {
  it("lundi dispensé : inscription possible la veille au soir", () => {
    const v = checkEnrollmentWindow({
      date: "2026-09-14",
      startTime: "09:00",
      waiveUntil: "2026-09-14",
      now: DIMANCHE,
    });
    expect(v).toEqual({ allowed: true });
  });

  it("lundi dispensé : inscription possible le matin même, avant le début", () => {
    const v = checkEnrollmentWindow({
      date: "2026-09-14",
      startTime: "14:00",
      waiveUntil: "2026-09-14",
      now: new Date("2026-09-14T13:59:00"),
    });
    expect(v).toEqual({ allowed: true });
  });

  it("lundi dispensé : mais plus une fois le créneau commencé", () => {
    const v = checkEnrollmentWindow({
      date: "2026-09-14",
      startTime: "09:00",
      waiveUntil: "2026-09-14",
      now: new Date("2026-09-14T09:30:00"),
    });
    expect(v).toEqual({ allowed: false, reason: "started" });
  });

  it("MARDI n'est PAS dispensé : la règle des 24h tient toujours", () => {
    const v = checkEnrollmentWindow({
      date: "2026-09-15",
      startTime: "09:00",
      waiveUntil: "2026-09-14",
      // lundi 10h : mardi 9h est à moins de 24h
      now: new Date("2026-09-14T10:00:00"),
    });
    expect(v).toEqual({ allowed: false, reason: "notice" });
  });

  it("mardi reste ouvert tant qu'il reste 24h", () => {
    const v = checkEnrollmentWindow({
      date: "2026-09-15",
      startTime: "09:00",
      waiveUntil: "2026-09-14",
      now: new Date("2026-09-14T08:00:00"),
    });
    expect(v).toEqual({ allowed: true });
  });

  it("l'exception se périme d'elle-même : une fois lundi passé, plus rien n'est dispensé", () => {
    const v = checkEnrollmentWindow({
      date: "2026-09-16",
      startTime: "09:00",
      waiveUntil: "2026-09-14",
      now: new Date("2026-09-15T10:00:00"),
    });
    expect(v).toEqual({ allowed: false, reason: "notice" });
  });
});

describe("checkEnrollmentWindow — données partielles", () => {
  it("ne bloque pas quand la date ou l'horaire manque", () => {
    expect(
      checkEnrollmentWindow({ date: null, startTime: "09:00", now: DIMANCHE }),
    ).toEqual({ allowed: true });
    expect(
      checkEnrollmentWindow({ date: "2026-09-14", startTime: "", now: DIMANCHE }),
    ).toEqual({ allowed: true });
  });

  it("ne bloque pas sur un horaire illisible (comportement historique)", () => {
    expect(
      checkEnrollmentWindow({
        date: "2026-09-14",
        startTime: "pas une heure",
        now: DIMANCHE,
      }),
    ).toEqual({ allowed: true });
  });

  it("accepte une date stockée en ISO complet", () => {
    const v = checkEnrollmentWindow({
      date: "2026-09-14T00:00:00+00:00",
      startTime: "09:00:00",
      waiveUntil: "2026-09-14",
      now: DIMANCHE,
    });
    expect(v).toEqual({ allowed: true });
  });
});

describe("isLastMinuteWaived", () => {
  it("dispense les jours antérieurs ou égaux, pas les suivants", () => {
    expect(isLastMinuteWaived("2026-09-13", "2026-09-14")).toBe(true);
    expect(isLastMinuteWaived("2026-09-14", "2026-09-14")).toBe(true);
    expect(isLastMinuteWaived("2026-09-15", "2026-09-14")).toBe(false);
  });

  it("passe le mois et l'année sans se tromper", () => {
    expect(isLastMinuteWaived("2026-10-01", "2026-09-30")).toBe(false);
    expect(isLastMinuteWaived("2026-09-30", "2026-10-01")).toBe(true);
  });
});

/** Lecteur de réglage qui rend `value` (ou une erreur) et note la clé lue. */
function fakeReader(
  result: { data: { value?: string | null } | null; error: unknown },
  seen: { key?: string } = {},
): SettingReader {
  return async (key: string) => {
    seen.key = key;
    return result;
  };
}

describe("readLastMinuteWaiveUntil", () => {
  it("lit la bonne clé et rend le jour", async () => {
    const seen: { key?: string } = {};
    const got = await readLastMinuteWaiveUntil(
      fakeClient({ data: { value: "2026-09-14" }, error: null }, seen),
    );
    expect(got).toBe("2026-09-14");
    expect(seen.key).toBe(LAST_MINUTE_SETTING_KEY);
  });

  it("réglage absent → null", async () => {
    expect(
      await readLastMinuteWaiveUntil(fakeClient({ data: null, error: null })),
    ).toBeNull();
  });

  it("erreur base → null (on retombe sur les 24h)", async () => {
    expect(
      await readLastMinuteWaiveUntil(
        fakeClient({ data: null, error: { message: "boom" } }),
      ),
    ).toBeNull();
  });

  it("valeur vidée par l'admin → null", async () => {
    expect(
      await readLastMinuteWaiveUntil(fakeClient({ data: { value: "" }, error: null })),
    ).toBeNull();
  });

  it("client qui lève → null", async () => {
    const client = {
      from: () => {
        throw new Error("réseau");
      },
    } as unknown as SettingsClient;
    expect(await readLastMinuteWaiveUntil(client)).toBeNull();
  });
});
