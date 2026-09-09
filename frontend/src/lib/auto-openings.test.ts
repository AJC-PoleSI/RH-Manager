import { describe, it, expect } from "vitest";
import { generateOpeningsFromCapacity } from "./auto-openings";
import { hhmmToMinutes, minutesToHHMM } from "./time-bands";

const win = (m: string, s: string, e: string) => ({
  memberId: m,
  startMin: hhmmToMinutes(s),
  endMin: hhmmToMinutes(e),
});

const base = {
  rooms: ["205", "217", "219"],
  evaluatorsPerGroupRoom: 4,
  evaluatorsPerIndividualRoom: 2,
  slotSpanMin: 30, // 25 min + 5 min de roulement
};

describe("generateOpeningsFromCapacity", () => {
  it("n'ouvre aucune salle sans examinateur", () => {
    const r = generateOpeningsFromCapacity({
      ...base,
      days: [{ dayIndex: 0, windows: [] }],
      targetSlots: 10,
    });
    expect(r.bands).toEqual([]);
    expect(r.reachedTarget).toBe(false);
  });

  it("ouvre une seule salle quand 2 examinateurs sont présents (individuel)", () => {
    const r = generateOpeningsFromCapacity({
      ...base,
      days: [
        { dayIndex: 0, windows: [win("a", "09:00", "12:00"), win("b", "09:00", "12:00")] },
      ],
      targetSlots: 3,
    });
    const rooms = new Set(r.bands.map((b) => b.laneId));
    expect(rooms.size).toBe(1);
    expect(r.bands[0].laneId).toBe("205");
  });

  it("ouvre deux salles collectives quand 8 examinateurs sont présents", () => {
    // 4 examinateurs par salle en collectif : 8 présents → exactement 2 salles.
    const r = generateOpeningsFromCapacity({
      ...base,
      days: [
        {
          dayIndex: 0,
          windows: ["a", "b", "c", "d", "e", "f", "g", "h"].map((m) =>
            win(m, "09:00", "12:00"),
          ),
        },
      ],
      targetSlots: 99,
    });
    const rooms = new Set(r.bands.map((b) => b.laneId));
    expect(rooms).toEqual(new Set(["205", "217"]));
  });

  it("s'arrête dès que la cible est atteinte", () => {
    const r = generateOpeningsFromCapacity({
      ...base,
      days: [
        { dayIndex: 0, windows: ["a", "b", "c", "d"].map((m) => win(m, "08:00", "20:30")) },
        { dayIndex: 1, windows: ["a", "b", "c", "d"].map((m) => win(m, "08:00", "20:30")) },
      ],
      targetSlots: 5,
    });
    expect(r.reachedTarget).toBe(true);
    expect(r.estimatedSlots).toBeGreaterThanOrEqual(5);
    // Il ne fallait qu'une fraction de la première journée : la seconde ne
    // doit pas être touchée.
    expect(r.bands.every((b) => b.dayIndex === 0)).toBe(true);
  });

  it("répartit sur plusieurs jours si un seul ne suffit pas à la cible", () => {
    const r = generateOpeningsFromCapacity({
      ...base,
      days: [
        { dayIndex: 0, windows: [win("a", "09:00", "10:00"), win("b", "09:00", "10:00")] },
        { dayIndex: 1, windows: [win("a", "09:00", "10:00"), win("b", "09:00", "10:00")] },
      ],
      targetSlots: 3,
    });
    const daysUsed = new Set(r.bands.map((b) => b.dayIndex));
    expect(daysUsed.size).toBeGreaterThan(1);
  });

  it("fusionne les tranches contiguës en une seule bande par salle", () => {
    const r = generateOpeningsFromCapacity({
      ...base,
      days: [
        { dayIndex: 0, windows: [win("a", "09:00", "17:00"), win("b", "09:00", "17:00")] },
      ],
      targetSlots: 99,
    });
    const roomBands = r.bands.filter((b) => b.laneId === "205");
    expect(roomBands).toHaveLength(1);
    expect(minutesToHHMM(roomBands[0].startMin)).toBe("09:00");
    expect(minutesToHHMM(roomBands[0].endMin)).toBe("17:00");
  });

  it("sépare deux plages non contiguës en deux bandes", () => {
    const r = generateOpeningsFromCapacity({
      ...base,
      days: [
        {
          dayIndex: 0,
          windows: [
            win("a", "08:00", "10:00"),
            win("b", "08:00", "10:00"),
            win("a", "16:00", "18:00"),
            win("b", "16:00", "18:00"),
          ],
        },
      ],
      targetSlots: 99,
    });
    const roomBands = r.bands.filter((b) => b.laneId === "205");
    expect(roomBands.length).toBeGreaterThanOrEqual(2);
  });

  it("ne dépasse jamais le nombre de salles déclarées", () => {
    const many = Array.from({ length: 40 }, (_, i) => win(`m${i}`, "09:00", "12:00"));
    const r = generateOpeningsFromCapacity({
      ...base,
      days: [{ dayIndex: 0, windows: many }],
      targetSlots: 999,
    });
    const rooms = new Set(r.bands.map((b) => b.laneId));
    expect(rooms.size).toBeLessThanOrEqual(base.rooms.length);
  });

  it("n'ouvre pas de plage trop courte pour un seul créneau", () => {
    const r = generateOpeningsFromCapacity({
      ...base,
      slotSpanMin: 60,
      days: [{ dayIndex: 0, windows: [win("a", "09:00", "09:30"), win("b", "09:00", "09:30")] }],
      targetSlots: 99,
    });
    expect(r.bands).toEqual([]);
  });

  it("les bandes produites sont toutes dans l'amplitude 08:00–20:30", () => {
    const r = generateOpeningsFromCapacity({
      ...base,
      days: [
        { dayIndex: 0, windows: [win("a", "07:00", "22:00"), win("b", "07:00", "22:00")] },
      ],
      targetSlots: 99,
    });
    for (const b of r.bands) {
      expect(b.startMin).toBeGreaterThanOrEqual(hhmmToMinutes("08:00"));
      expect(b.endMin).toBeLessThanOrEqual(hhmmToMinutes("20:30"));
    }
  });
});
