import { describe, it, expect } from "vitest";
import { sliceOpening, diffOpeningSlots } from "./opening-slicer";

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
