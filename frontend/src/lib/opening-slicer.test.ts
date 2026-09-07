import { describe, it, expect } from "vitest";
import {
  sliceOpening,
  diffOpeningSlots,
  weekdaysBetween,
  openingDateCandidates,
  resolveOpeningDates,
} from "./opening-slicer";

const P = { durationMinutes: 30, roulementMinutes: 10 }; // spacing 40

describe("sliceOpening", () => {
  it("découpe une plage simple", () => {
    const r = sliceOpening({ startTime: "09:00", endTime: "11:00" }, P);
    expect(r).toEqual([
      { startTime: "09:00", endTime: "09:30" },
      { startTime: "09:40", endTime: "10:10" },
      { startTime: "10:20", endTime: "10:50" },
    ]);
  });

  it("saute la pause et reprend à sa fin", () => {
    const r = sliceOpening(
      {
        startTime: "09:00",
        endTime: "17:00",
        breakStart: "12:00",
        breakEnd: "13:30",
      },
      P,
    );
    // aucun créneau ne chevauche 12:00–13:30 (720–810 min)
    const toMin = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
    for (const s of r) {
      expect(toMin(s.endTime) <= 720 || toMin(s.startTime) >= 810).toBe(true);
    }
    // le premier créneau après la pause commence à 13:30
    expect(r.some((s) => s.startTime === "13:30")).toBe(true);
  });

  it("plage trop courte → aucun créneau", () => {
    expect(sliceOpening({ startTime: "09:00", endTime: "09:20" }, P)).toEqual(
      [],
    );
  });

  it("le dernier créneau finit au plus tard à end_time", () => {
    const r = sliceOpening({ startTime: "09:00", endTime: "10:00" }, P);
    expect(r[r.length - 1].endTime <= "10:00").toBe(true);
  });

  it("est déterministe", () => {
    const o = {
      startTime: "08:00",
      endTime: "18:00",
      breakStart: "12:00",
      breakEnd: "14:00",
    };
    expect(sliceOpening(o, P)).toEqual(sliceOpening(o, P));
  });
});

describe("diffOpeningSlots", () => {
  const target = [
    { startTime: "09:00", endTime: "09:30" },
    { startTime: "09:40", endTime: "10:10" },
  ];

  it("conserve les créneaux qui matchent, crée les manquants", () => {
    const d = diffOpeningSlots("2026-07-14", target, [
      {
        id: "a",
        date: "2026-07-14",
        start_time: "09:00",
        end_time: "09:30",
        occupied: false,
      },
    ]);
    expect(d.keptIds).toEqual(["a"]);
    expect(d.toCreate).toEqual([{ startTime: "09:40", endTime: "10:10" }]);
    expect(d.toDeleteIds).toEqual([]);
    expect(d.conflictIds).toEqual([]);
  });

  it("supprime les libres hors cible, signale les occupés hors cible", () => {
    const d = diffOpeningSlots("2026-07-14", target, [
      {
        id: "libre",
        date: "2026-07-14",
        start_time: "16:00",
        end_time: "16:30",
        occupied: false,
      },
      {
        id: "occ",
        date: "2026-07-14",
        start_time: "17:00",
        end_time: "17:30",
        occupied: true,
      },
    ]);
    expect(d.toDeleteIds).toEqual(["libre"]);
    expect(d.conflictIds).toEqual(["occ"]);
  });

  it("un occupé qui matche la cible est conservé sans doublon de création", () => {
    const d = diffOpeningSlots("2026-07-14", target, [
      {
        id: "occ",
        date: "2026-07-14",
        start_time: "09:00",
        end_time: "09:30",
        occupied: true,
      },
    ]);
    expect(d.keptIds).toEqual(["occ"]);
    expect(d.toCreate).toEqual([{ startTime: "09:40", endTime: "10:10" }]);
    expect(d.conflictIds).toEqual([]);
  });

  it("changement de date : tout l'existant est hors cible", () => {
    const d = diffOpeningSlots("2026-07-15", target, [
      {
        id: "libre",
        date: "2026-07-14",
        start_time: "09:00",
        end_time: "09:30",
        occupied: false,
      },
      {
        id: "occ",
        date: "2026-07-14",
        start_time: "09:40",
        end_time: "10:10",
        occupied: true,
      },
    ]);
    expect(d.toDeleteIds).toEqual(["libre"]);
    expect(d.conflictIds).toEqual(["occ"]);
    expect(d.toCreate).toHaveLength(2);
  });

  it("gère les dates ISO avec heure côté existant", () => {
    const d = diffOpeningSlots("2026-07-14", target, [
      {
        id: "a",
        date: "2026-07-14T12:00:00.000Z",
        start_time: "09:00:00",
        end_time: "09:30:00",
        occupied: false,
      },
    ]);
    expect(d.keptIds).toEqual(["a"]);
  });
});

describe("weekdaysBetween", () => {
  it("liste les jours ouvrés d'une semaine complète", () => {
    // 2026-09-07 = lundi ... 2026-09-13 = dimanche
    expect(weekdaysBetween("2026-09-07", "2026-09-13")).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
    ]);
  });

  it("exclut les weekends dans une plage qui les traverse", () => {
    // 2026-09-11 = vendredi, 2026-09-14 = lundi
    expect(weekdaysBetween("2026-09-11", "2026-09-14")).toEqual([
      "2026-09-11",
      "2026-09-14",
    ]);
  });

  it("plage d'un seul jour ouvré", () => {
    expect(weekdaysBetween("2026-09-07", "2026-09-07")).toEqual([
      "2026-09-07",
    ]);
  });

  it("plage d'un seul jour tombant un weekend → vide", () => {
    // 2026-09-12 = samedi
    expect(weekdaysBetween("2026-09-12", "2026-09-12")).toEqual([]);
  });

  it("end < start → vide", () => {
    expect(weekdaysBetween("2026-09-10", "2026-09-07")).toEqual([]);
  });

  it("dates vides → vide", () => {
    expect(weekdaysBetween("", "2026-09-07")).toEqual([]);
    expect(weekdaysBetween("2026-09-07", "")).toEqual([]);
  });
});

describe("openingDateCandidates", () => {
  it("un seul jour si dateEnd vide", () => {
    expect(openingDateCandidates("2026-09-12", "")).toEqual(["2026-09-12"]);
  });

  it("un seul jour (weekend inclus) si dateEnd <= date", () => {
    // 2026-09-12 = samedi : autorisé car c'est un jour unique, pas une plage
    expect(openingDateCandidates("2026-09-12", "2026-09-12")).toEqual([
      "2026-09-12",
    ]);
    expect(openingDateCandidates("2026-09-12", "2026-09-10")).toEqual([
      "2026-09-12",
    ]);
  });

  it("jours ouvrés de la plage si dateEnd > date", () => {
    expect(openingDateCandidates("2026-09-07", "2026-09-11")).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
    ]);
  });
});

describe("resolveOpeningDates", () => {
  it("retire les dates exclues", () => {
    const excluded = new Set(["2026-09-09"]);
    expect(resolveOpeningDates("2026-09-07", "2026-09-11", excluded)).toEqual(
      ["2026-09-07", "2026-09-08", "2026-09-10", "2026-09-11"],
    );
  });

  it("aucune exclusion → identique aux candidats", () => {
    expect(
      resolveOpeningDates("2026-09-07", "2026-09-11", new Set()),
    ).toEqual(openingDateCandidates("2026-09-07", "2026-09-11"));
  });

  it("toutes exclues → vide", () => {
    expect(
      resolveOpeningDates("2026-09-07", "2026-09-07", new Set(["2026-09-07"])),
    ).toEqual([]);
  });
});
