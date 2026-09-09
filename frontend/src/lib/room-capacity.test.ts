import { describe, it, expect } from "vitest";
import {
  computeCapacity,
  CAPACITY_STEP_MIN,
  type AvailabilityWindow,
} from "./room-capacity";
import { hhmmToMinutes, GRID_START_MIN, GRID_END_MIN } from "./time-bands";

const win = (memberId: string, s: string, e: string): AvailabilityWindow => ({
  memberId,
  startMin: hhmmToMinutes(s),
  endMin: hhmmToMinutes(e),
});

/** Tranche couvrant l'heure demandée. */
const at = (r: ReturnType<typeof computeCapacity>, hhmm: string) =>
  r.slices.find((s) => s.startMin === hhmmToMinutes(hhmm))!;

const base = {
  totalRooms: 6,
  evaluatorsPerGroupRoom: 4,
  evaluatorsPerIndividualRoom: 2,
};

describe("découpage de la journée", () => {
  it("couvre 08:00 → 20:30 par pas de 30 min", () => {
    const r = computeCapacity({ ...base, windows: [] });
    expect(r.slices[0].startMin).toBe(GRID_START_MIN);
    expect(r.slices.length).toBe((GRID_END_MIN - GRID_START_MIN) / CAPACITY_STEP_MIN);
    const last = r.slices[r.slices.length - 1];
    expect(last.startMin + CAPACITY_STEP_MIN).toBeLessThanOrEqual(GRID_END_MIN);
  });
});

describe("comptage des examinateurs", () => {
  it("compte un examinateur qui couvre toute la tranche", () => {
    const r = computeCapacity({ ...base, windows: [win("a", "09:00", "10:00")] });
    expect(at(r, "09:00").available).toBe(1);
    expect(at(r, "09:30").available).toBe(1);
  });

  it("ne compte PAS un examinateur qui ne couvre la tranche qu'en partie", () => {
    // Présent 09:00–09:20 : il ne peut pas tenir la demi-heure entière.
    const r = computeCapacity({ ...base, windows: [win("a", "09:00", "09:20")] });
    expect(at(r, "09:00").available).toBe(0);
  });

  it("ne compte un examinateur qu'une fois, même avec deux bandes", () => {
    const r = computeCapacity({
      ...base,
      windows: [win("a", "09:00", "10:00"), win("a", "09:00", "12:00")],
    });
    expect(at(r, "09:00").available).toBe(1);
  });

  it("additionne des examinateurs différents", () => {
    const r = computeCapacity({
      ...base,
      windows: [win("a", "09:00", "12:00"), win("b", "09:00", "12:00")],
    });
    expect(at(r, "09:00").available).toBe(2);
  });
});

describe("règle collectif → individuel", () => {
  it("4 examinateurs (min collectif) → mode groupe, 1 salle", () => {
    const r = computeCapacity({
      ...base,
      windows: ["a", "b", "c", "d"].map((m) => win(m, "09:00", "12:00")),
    });
    expect(at(r, "09:00").mode).toBe("groupe");
    expect(at(r, "09:00").rooms).toBe(1);
  });

  it("8 examinateurs → 2 salles collectives", () => {
    const r = computeCapacity({
      ...base,
      windows: ["a", "b", "c", "d", "e", "f", "g", "h"].map((m) =>
        win(m, "09:00", "12:00"),
      ),
    });
    expect(at(r, "09:00").mode).toBe("groupe");
    expect(at(r, "09:00").rooms).toBe(2);
  });

  it("3 examinateurs : sous le minimum collectif → repli individuel", () => {
    const r = computeCapacity({
      ...base,
      windows: ["a", "b", "c"].map((m) => win(m, "09:00", "12:00")),
    });
    expect(at(r, "09:00").mode).toBe("individuel");
    expect(at(r, "09:00").rooms).toBe(1); // floor(3 / 2)
  });

  it("1 examinateur : même pas de quoi tenir un individuel", () => {
    const r = computeCapacity({ ...base, windows: [win("a", "09:00", "12:00")] });
    expect(at(r, "09:00").mode).toBe("aucun");
    expect(at(r, "09:00").rooms).toBe(0);
  });

  it("aucun examinateur → aucune salle", () => {
    const r = computeCapacity({ ...base, windows: [] });
    expect(at(r, "09:00").mode).toBe("aucun");
    expect(at(r, "09:00").rooms).toBe(0);
  });
});

describe("plafonnement par le nombre de salles", () => {
  it("ne propose jamais plus de salles qu'il n'en existe", () => {
    // 20 examinateurs = 5 salles collectives possibles, mais 2 salles seulement.
    const many = Array.from({ length: 20 }, (_, i) => win(`m${i}`, "09:00", "12:00"));
    const r = computeCapacity({ ...base, totalRooms: 2, windows: many });
    expect(at(r, "09:00").rooms).toBe(2);
    expect(at(r, "09:00").roomsIfUnlimited).toBe(5);
    expect(at(r, "09:00").roomLimited).toBe(true);
  });

  it("signale quand c'est l'effectif, et non les salles, qui limite", () => {
    const r = computeCapacity({
      ...base,
      totalRooms: 6,
      windows: ["a", "b", "c", "d"].map((m) => win(m, "09:00", "12:00")),
    });
    expect(at(r, "09:00").roomLimited).toBe(false);
  });

  it("zéro salle déclarée → zéro salle tenable", () => {
    const r = computeCapacity({
      ...base,
      totalRooms: 0,
      windows: ["a", "b", "c", "d"].map((m) => win(m, "09:00", "12:00")),
    });
    expect(at(r, "09:00").rooms).toBe(0);
  });
});

describe("synthèse de la journée", () => {
  it("relève le pic d'effectif et les tranches vides", () => {
    const r = computeCapacity({
      ...base,
      windows: [
        win("a", "09:00", "11:00"),
        win("b", "09:00", "11:00"),
        win("c", "10:00", "11:00"),
      ],
    });
    expect(r.peak).toBe(3);
    expect(at(r, "10:00").available).toBe(3);
    expect(at(r, "08:00").available).toBe(0);
    expect(r.emptySlices).toBeGreaterThan(0);
  });

  it("maxRooms reflète le meilleur moment de la journée", () => {
    const r = computeCapacity({
      ...base,
      windows: ["a", "b", "c", "d"].map((m) => win(m, "14:00", "16:00")),
    });
    expect(r.maxRooms).toBe(1);
  });
});

describe("robustesse", () => {
  it("des minimums à zéro ne provoquent pas de division par zéro", () => {
    const r = computeCapacity({
      windows: ["a", "b"].map((m) => win(m, "09:00", "12:00")),
      totalRooms: 3,
      evaluatorsPerGroupRoom: 0,
      evaluatorsPerIndividualRoom: 0,
    });
    expect(Number.isFinite(at(r, "09:00").rooms)).toBe(true);
  });
});
