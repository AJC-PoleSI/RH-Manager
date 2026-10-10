import { describe, it, expect } from "vitest";
import {
  blockingWindowOf,
  blockingWindowsOf,
  findBlockingWindow,
  slotBlockedBy,
  blockedRangesOn,
  blockingMessage,
  parseBlocageMode,
} from "./epreuve-bloquante";

// Épreuve sur table telle que stockée : date_debut à minuit UTC (cf. POST
// /api/epreuves, `new Date("YYYY-MM-DD").toISOString()`).
const surTable = (over: Record<string, unknown> = {}) => ({
  id: "ep-table",
  name: "Épreuve commune",
  type: "commune",
  date_debut: "2027-10-11T00:00:00.000Z",
  heure_debut: "14:00",
  duration_minutes: 120,
  blocage_autres_epreuves: "pendant",
  ...over,
});

describe("blockingWindowOf", () => {
  it("désactivé par défaut : aucune fenêtre", () => {
    expect(blockingWindowOf(surTable({ blocage_autres_epreuves: null }))).toBeNull();
    // colonne pas encore migrée
    const { blocage_autres_epreuves: _omit, ...sansColonne } = surTable();
    expect(blockingWindowOf(sansColonne)).toBeNull();
  });

  it("« pendant » : de l'heure de convocation à heure + durée", () => {
    expect(blockingWindowOf(surTable())).toEqual({
      epreuveId: "ep-table",
      name: "Épreuve commune",
      date: "2027-10-11",
      startMin: 14 * 60,
      endMin: 16 * 60,
      wholeDay: false,
    });
  });

  it("« journee » : toute la journée", () => {
    const w = blockingWindowOf(surTable({ blocage_autres_epreuves: "journee" }));
    expect(w).toMatchObject({ startMin: 0, endMin: 1440, wholeDay: true });
  });

  it("« pendant » sans heure de convocation : toute la journée par prudence", () => {
    const w = blockingWindowOf(surTable({ heure_debut: null }));
    expect(w).toMatchObject({ startMin: 0, endMin: 1440, wholeDay: true });
  });

  it("seules les épreuves sur table bloquent", () => {
    expect(blockingWindowOf(surTable({ type: "individuelle" }))).toBeNull();
    expect(blockingWindowOf(surTable({ type: "groupe" }))).toBeNull();
  });

  it("sans date : rien à bloquer", () => {
    expect(blockingWindowOf(surTable({ date_debut: null }))).toBeNull();
  });

  it("valeur inconnue = désactivé", () => {
    expect(parseBlocageMode("oui")).toBeNull();
    expect(parseBlocageMode(true)).toBeNull();
    expect(parseBlocageMode("pendant")).toBe("pendant");
  });
});

describe("findBlockingWindow / slotBlockedBy", () => {
  const windows = blockingWindowsOf([surTable(), { type: "individuelle" }]);

  it("chevauchement, même d'une minute, sur toutes les autres épreuves", () => {
    expect(findBlockingWindow(windows, "2027-10-11", 13 * 60 + 30, 14 * 60 + 1)).not.toBeNull();
    expect(findBlockingWindow(windows, "2027-10-11", 15 * 60, 15 * 60 + 30)).not.toBeNull();
    expect(findBlockingWindow(windows, "2027-10-11", 15 * 60 + 59, 17 * 60)).not.toBeNull();
  });

  it("bord à bord : autorisé", () => {
    expect(findBlockingWindow(windows, "2027-10-11", 13 * 60 + 30, 14 * 60)).toBeNull();
    expect(findBlockingWindow(windows, "2027-10-11", 16 * 60, 16 * 60 + 30)).toBeNull();
  });

  it("autre jour : autorisé", () => {
    expect(findBlockingWindow(windows, "2027-10-12", 14 * 60, 15 * 60)).toBeNull();
  });

  it("créneau stocké (date à midi local en UTC, horaires HH:MM:SS)", () => {
    const slot = {
      date: "2027-10-11T10:00:00+00:00",
      start_time: "14:30:00",
      end_time: "15:00:00",
      epreuve_id: "ep-entretien",
    };
    expect(slotBlockedBy(windows, slot)?.epreuveId).toBe("ep-table");
    expect(slotBlockedBy([], slot)).toBeNull();
  });

  it("l'épreuve sur table ne se bloque pas elle-même", () => {
    expect(
      findBlockingWindow(windows, "2027-10-11", 14 * 60, 15 * 60, "ep-table"),
    ).toBeNull();
  });
});

describe("blockedRangesOn / blockingMessage", () => {
  const windows = blockingWindowsOf([surTable()]);

  it("plages du jour au format HH:MM pour le découpage", () => {
    expect(blockedRangesOn(windows, "2027-10-11")).toEqual([
      { start: "14:00", end: "16:00" },
    ]);
    expect(blockedRangesOn(windows, "2027-10-12")).toEqual([]);
    expect(blockedRangesOn(windows, "2027-10-11", "ep-table")).toEqual([]);
  });

  it("message lisible", () => {
    expect(blockingMessage(windows[0])).toBe(
      "L'épreuve sur table « Épreuve commune » bloque tous les autres entretiens le 11/10 de 14:00 à 16:00.",
    );
    const journee = blockingWindowsOf([surTable({ blocage_autres_epreuves: "journee" })]);
    expect(blockingMessage(journee[0])).toContain("toute la journée du 11/10");
  });
});
