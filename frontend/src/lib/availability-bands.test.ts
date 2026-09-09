import { describe, it, expect } from "vitest";
import {
  rowsToBands,
  bandsToRows,
  localYmd,
  MERGE_TOLERANCE_MIN,
} from "./availability-bands";
import { minutesToHHMM, hhmmToMinutes } from "./time-bands";

/** Lundi 14 septembre 2026 → vendredi 18. */
const days = [14, 15, 16, 17, 18].map((d) => new Date(2026, 8, d, 12));
const at = (day: number, s: string, e: string) => ({
  date: `2026-09-${String(day).padStart(2, "0")}T12:00:00+00:00`,
  start_time: s,
  end_time: e,
});
const show = (b: { startMin: number; endMin: number }) =>
  `${minutesToHHMM(b.startMin)}-${minutesToHHMM(b.endMin)}`;

describe("rowsToBands", () => {
  it("fusionne des cases séparées par un roulement", () => {
    const out = rowsToBands(
      [at(14, "08:00", "08:25"), at(14, "08:30", "08:55")],
      days,
    );
    expect(out.map(show)).toEqual(["08:00-08:55"]);
  });

  it("laisse deux bandes quand l'écart dépasse la tolérance", () => {
    const out = rowsToBands(
      [at(14, "08:00", "10:00"), at(14, "12:00", "14:00")],
      days,
    );
    expect(out.map(show)).toEqual(["08:00-10:00", "12:00-14:00"]);
  });

  it("reproduit un cas réel : 5 cases d'Alexandre le 14/09", () => {
    const out = rowsToBands(
      [
        at(14, "11:30", "11:55"),
        at(14, "12:20", "13:20"),
        at(14, "15:50", "16:50"),
        at(14, "17:00", "17:25"),
        at(14, "17:30", "17:55"),
      ],
      days,
    );
    // 11:55→12:20 (25 min) et 13:20→15:50 coupent ; 16:50→17:00 (10 min) et
    // 17:25→17:30 (5 min) fusionnent. Cinq cases deviennent trois bandes.
    expect(out.map(show)).toEqual([
      "11:30-11:55",
      "12:20-13:20",
      "15:50-17:55",
    ]);
  });

  it("n'élargit jamais de plus que la tolérance", () => {
    const out = rowsToBands(
      [at(14, "09:00", "10:00"), at(14, "10:15", "11:00")],
      days,
    );
    const [b] = out;
    const couvert = b.endMin - b.startMin;
    const declare = 60 + 45;
    expect(couvert - declare).toBeLessThanOrEqual(MERGE_TOLERANCE_MIN);
  });

  it("répartit sur les bonnes colonnes", () => {
    const out = rowsToBands(
      [at(14, "08:00", "09:00"), at(16, "10:00", "11:00")],
      days,
    );
    expect(out.map((b) => b.dayIndex)).toEqual([0, 2]);
  });

  it("ignore les lignes hors de la semaine affichée", () => {
    expect(rowsToBands([at(28, "08:00", "09:00")], days)).toEqual([]);
  });

  it("ignore les lignes incomplètes", () => {
    expect(
      rowsToBands(
        [
          { date: null, start_time: "08:00", end_time: "09:00" },
          { date: `2026-09-14`, start_time: null, end_time: "09:00" },
        ],
        days,
      ),
    ).toEqual([]);
  });

  it("tolère un horaire avec des secondes", () => {
    const out = rowsToBands([at(14, "08:00:00", "09:30:00")], days);
    expect(out.map(show)).toEqual(["08:00-09:30"]);
  });

  it("ne fusionne jamais deux journées", () => {
    const out = rowsToBands(
      [at(14, "19:00", "20:00"), at(15, "08:00", "09:00")],
      days,
    );
    expect(out).toHaveLength(2);
  });

  it("la tolérance reste sous la plus courte épreuve (20 min)", () => {
    expect(MERGE_TOLERANCE_MIN).toBeLessThan(20);
  });
});

describe("bandsToRows", () => {
  const band = (dayIndex: number, s: string, e: string) => ({
    id: "x",
    dayIndex,
    laneId: "",
    startMin: hhmmToMinutes(s),
    endMin: hhmmToMinutes(e),
  });

  it("place la date au bon jour, à midi local", () => {
    const [row] = bandsToRows([band(2, "09:00", "17:00")], days);
    expect(localYmd(new Date(row.date))).toBe("2026-09-16");
    expect(row.weekday).toBe("wed");
    expect(row.startTime).toBe("09:00");
    expect(row.endTime).toBe("17:00");
  });

  it("fait l'aller-retour sans rien perdre", () => {
    const initial = [
      at(14, "08:00", "10:00"),
      at(16, "12:00", "14:30"),
      at(18, "09:15", "20:30"),
    ];
    const bands = rowsToBands(initial, days);
    const rows = bandsToRows(bands, days);
    const back = rowsToBands(
      rows.map((r) => ({
        date: r.date,
        start_time: r.startTime,
        end_time: r.endTime,
      })),
      days,
    );
    expect(back.map(show)).toEqual(bands.map(show));
    expect(back.map((b) => b.dayIndex)).toEqual(bands.map((b) => b.dayIndex));
  });

  it("écarte une bande dont le jour n'existe pas", () => {
    expect(bandsToRows([band(9, "09:00", "10:00")], days)).toEqual([]);
  });
});
