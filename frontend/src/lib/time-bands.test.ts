import { describe, it, expect } from "vitest";
import {
  GRID_START_MIN,
  GRID_END_MIN,
  SNAP_DRAG,
  SNAP_EDIT,
  minutesToHHMM,
  hhmmToMinutes,
  formatDuration,
  snap,
  clampToGrid,
  minToRatio,
  ratioToMin,
  mergeIntervals,
  normalizeBands,
  bandFromDrag,
  type Band,
} from "./time-bands";

const band = (p: Partial<Band>): Band => ({
  id: "b",
  dayIndex: 0,
  laneId: "",
  startMin: 0,
  endMin: 0,
  ...p,
});

describe("amplitude de la grille", () => {
  it("va de 08:00 à 20:30", () => {
    expect(minutesToHHMM(GRID_START_MIN)).toBe("08:00");
    expect(minutesToHHMM(GRID_END_MIN)).toBe("20:30");
  });

  it("couvre les dispos réelles qui débordent à 20:20", () => {
    expect(hhmmToMinutes("20:20")).toBeLessThanOrEqual(GRID_END_MIN);
  });
});

describe("conversions", () => {
  it("fait l'aller-retour minutes ↔ HH:MM", () => {
    for (const t of ["08:00", "12:35", "17:30", "20:30"]) {
      expect(minutesToHHMM(hhmmToMinutes(t))).toBe(t);
    }
  });

  it("tolère une heure avec des secondes", () => {
    expect(hhmmToMinutes("09:15:00")).toBe(9 * 60 + 15);
  });

  it("écrit les durées lisiblement", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(90)).toBe("1h30");
    expect(formatDuration(540)).toBe("9h");
  });
});

describe("aimantation", () => {
  it("arrondit au pas le plus proche", () => {
    expect(snap(hhmmToMinutes("08:37"), SNAP_DRAG)).toBe(hhmmToMinutes("08:30"));
    expect(snap(hhmmToMinutes("08:38"), SNAP_DRAG)).toBe(hhmmToMinutes("08:45"));
    expect(snap(hhmmToMinutes("08:37"), SNAP_EDIT)).toBe(hhmmToMinutes("08:35"));
  });

  it("ne bouge pas une heure déjà sur le pas", () => {
    expect(snap(hhmmToMinutes("14:30"), SNAP_DRAG)).toBe(hhmmToMinutes("14:30"));
  });
});

describe("bornage", () => {
  it("ramène dans l'amplitude", () => {
    expect(clampToGrid(0)).toBe(GRID_START_MIN);
    expect(clampToGrid(23 * 60)).toBe(GRID_END_MIN);
    expect(clampToGrid(hhmmToMinutes("12:00"))).toBe(hhmmToMinutes("12:00"));
  });

  it("fait l'aller-retour ratio ↔ minutes", () => {
    expect(minToRatio(GRID_START_MIN)).toBe(0);
    expect(minToRatio(GRID_END_MIN)).toBe(1);
    expect(Math.round(ratioToMin(minToRatio(hhmmToMinutes("15:45"))))).toBe(
      hhmmToMinutes("15:45"),
    );
  });
});

describe("mergeIntervals", () => {
  it("fusionne ce qui se chevauche", () => {
    expect(mergeIntervals([{ start: 10, end: 30 }, { start: 20, end: 40 }])).toEqual([
      { start: 10, end: 40 },
    ]);
  });

  it("fusionne ce qui se touche exactement", () => {
    expect(mergeIntervals([{ start: 10, end: 20 }, { start: 20, end: 30 }])).toEqual([
      { start: 10, end: 30 },
    ]);
  });

  it("laisse séparé ce qui dépasse la tolérance", () => {
    expect(
      mergeIntervals([{ start: 10, end: 20 }, { start: 40, end: 50 }], 15),
    ).toEqual([
      { start: 10, end: 20 },
      { start: 40, end: 50 },
    ]);
  });

  it("fusionne un écart inférieur ou égal à la tolérance", () => {
    expect(
      mergeIntervals([{ start: 10, end: 20 }, { start: 35, end: 50 }], 15),
    ).toEqual([{ start: 10, end: 50 }]);
  });

  it("redresse un intervalle inversé", () => {
    expect(mergeIntervals([{ start: 40, end: 10 }])).toEqual([
      { start: 10, end: 40 },
    ]);
  });

  it("écarte les intervalles vides", () => {
    expect(mergeIntervals([{ start: 10, end: 10 }])).toEqual([]);
  });

  it("absorbe un intervalle entièrement contenu dans un autre", () => {
    expect(
      mergeIntervals([{ start: 0, end: 100 }, { start: 20, end: 30 }]),
    ).toEqual([{ start: 0, end: 100 }]);
  });

  it("ne dépend pas de l'ordre d'entrée", () => {
    const a = mergeIntervals([{ start: 40, end: 50 }, { start: 10, end: 20 }]);
    const b = mergeIntervals([{ start: 10, end: 20 }, { start: 40, end: 50 }]);
    expect(a).toEqual(b);
  });
});

describe("normalizeBands", () => {
  const h = hhmmToMinutes;

  it("garde deux bandes distinctes dans la même journée", () => {
    const out = normalizeBands([
      band({ id: "1", startMin: h("08:00"), endMin: h("10:00") }),
      band({ id: "2", startMin: h("12:00"), endMin: h("14:00") }),
    ]);
    expect(out).toHaveLength(2);
    expect(minutesToHHMM(out[0].startMin)).toBe("08:00");
    expect(minutesToHHMM(out[1].startMin)).toBe("12:00");
  });

  it("fusionne deux bandes amenées bord à bord par un redimensionnement", () => {
    const out = normalizeBands([
      band({ id: "1", startMin: h("08:00"), endMin: h("10:00") }),
      band({ id: "2", startMin: h("10:00"), endMin: h("12:00") }),
    ]);
    expect(out).toHaveLength(1);
    expect(minutesToHHMM(out[0].startMin)).toBe("08:00");
    expect(minutesToHHMM(out[0].endMin)).toBe("12:00");
    expect(out[0].id).toBe("1");
  });

  it("ne fusionne pas entre deux journées différentes", () => {
    const out = normalizeBands([
      band({ id: "1", dayIndex: 0, startMin: h("08:00"), endMin: h("10:00") }),
      band({ id: "2", dayIndex: 1, startMin: h("08:00"), endMin: h("10:00") }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("ne fusionne pas entre deux salles différentes", () => {
    const out = normalizeBands([
      band({ id: "1", laneId: "205", startMin: h("08:00"), endMin: h("10:00") }),
      band({ id: "2", laneId: "217", startMin: h("09:00"), endMin: h("11:00") }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("redresse une bande tracée vers le haut", () => {
    const out = normalizeBands([
      band({ id: "1", startMin: h("17:00"), endMin: h("09:00") }),
    ]);
    expect(minutesToHHMM(out[0].startMin)).toBe("09:00");
    expect(minutesToHHMM(out[0].endMin)).toBe("17:00");
  });

  it("écarte une bande trop courte", () => {
    expect(
      normalizeBands([band({ id: "1", startMin: h("09:00"), endMin: h("09:05") })]),
    ).toEqual([]);
  });

  it("borne une bande qui dépasse la grille", () => {
    const out = normalizeBands([
      band({ id: "1", startMin: 0, endMin: 24 * 60 }),
    ]);
    expect(minutesToHHMM(out[0].startMin)).toBe("08:00");
    expect(minutesToHHMM(out[0].endMin)).toBe("20:30");
  });

  it("est idempotente", () => {
    const input = [
      band({ id: "1", startMin: h("08:00"), endMin: h("10:00") }),
      band({ id: "2", startMin: h("09:30"), endMin: h("12:00") }),
    ];
    const once = normalizeBands(input);
    expect(normalizeBands(once)).toEqual(once);
  });
});

describe("bandFromDrag", () => {
  const h = hhmmToMinutes;

  it("aimante les deux extrémités du geste", () => {
    const b = bandFromDrag(h("08:34"), h("17:26"))!;
    expect(minutesToHHMM(b.start)).toBe("08:30");
    expect(minutesToHHMM(b.end)).toBe("17:30");
  });

  it("accepte un glissement vers le haut", () => {
    const b = bandFromDrag(h("17:30"), h("08:30"))!;
    expect(minutesToHHMM(b.start)).toBe("08:30");
    expect(minutesToHHMM(b.end)).toBe("17:30");
  });

  it("renvoie null pour un simple clic", () => {
    expect(bandFromDrag(h("09:00"), h("09:02"))).toBeNull();
  });

  it("ne laisse pas déborder de la grille", () => {
    const b = bandFromDrag(6 * 60, 23 * 60)!;
    expect(minutesToHHMM(b.start)).toBe("08:00");
    expect(minutesToHHMM(b.end)).toBe("20:30");
  });
});
