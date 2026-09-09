import { describe, it, expect } from "vitest";
import { diffOpenings, openingsToBands, type OpeningRow } from "./openings-diff";
import { hhmmToMinutes, type Band } from "./time-bands";

const DAYS = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"];

const opening = (p: Partial<OpeningRow>): OpeningRow => ({
  id: "o1",
  room: "205",
  date: "2026-09-14",
  start_time: "08:00",
  end_time: "18:00",
  ...p,
});
const band = (p: Partial<Band>): Band => ({
  id: "o1",
  dayIndex: 0,
  laneId: "205",
  startMin: hhmmToMinutes("08:00"),
  endMin: hhmmToMinutes("18:00"),
  ...p,
});

describe("openingsToBands", () => {
  it("place l'ouverture sur la bonne colonne et la bonne salle", () => {
    const [b] = openingsToBands([opening({ date: "2026-09-16", room: "217" })], DAYS);
    expect(b.dayIndex).toBe(2);
    expect(b.laneId).toBe("217");
    expect(b.id).toBe("o1");
  });

  it("ignore une ouverture hors de la semaine affichée", () => {
    expect(openingsToBands([opening({ date: "2026-10-01" })], DAYS)).toEqual([]);
  });

  it("tolère une date au format ISO complet", () => {
    const [b] = openingsToBands([opening({ date: "2026-09-15T00:00:00Z" })], DAYS);
    expect(b.dayIndex).toBe(1);
  });
});

describe("diffOpenings", () => {
  it("ne fait rien quand rien ne bouge", () => {
    const d = diffOpenings([opening({})], [band({})], DAYS);
    expect(d).toMatchObject({ toCreate: [], toUpdate: [], toDelete: [] });
    expect(d.unchanged).toBe(1);
  });

  it("détecte un redimensionnement", () => {
    const d = diffOpenings(
      [opening({})],
      [band({ endMin: hhmmToMinutes("16:00") })],
      DAYS,
    );
    expect(d.toUpdate).toEqual([
      { id: "o1", room: "205", date: "2026-09-14", startTime: "08:00", endTime: "16:00" },
    ]);
    expect(d.toDelete).toEqual([]);
  });

  it("détecte une bande tracée à la souris", () => {
    const d = diffOpenings(
      [opening({})],
      [band({}), band({ id: "band-local-1", laneId: "217", dayIndex: 3 })],
      DAYS,
    );
    expect(d.toCreate).toEqual([
      { room: "217", date: "2026-09-17", startTime: "08:00", endTime: "18:00" },
    ]);
    expect(d.toDelete).toEqual([]);
  });

  it("détecte une suppression", () => {
    const d = diffOpenings([opening({}), opening({ id: "o2", room: "217" })], [band({})], DAYS);
    expect(d.toDelete).toEqual(["o2"]);
  });

  it("traduit une fusion de deux ouvertures en une mise à jour + une suppression", () => {
    // o1 08:00–12:00 et o2 12:00–18:00 fusionnent : normalizeBands garde l'id
    // de la première et étend sa fin ; la seconde disparaît.
    const initial = [
      opening({ id: "o1", start_time: "08:00", end_time: "12:00" }),
      opening({ id: "o2", start_time: "12:00", end_time: "18:00" }),
    ];
    const merged = [band({ id: "o1", startMin: hhmmToMinutes("08:00"), endMin: hhmmToMinutes("18:00") })];
    const d = diffOpenings(initial, merged, DAYS);
    expect(d.toUpdate).toHaveLength(1);
    expect(d.toUpdate[0].endTime).toBe("18:00");
    expect(d.toDelete).toEqual(["o2"]);
    expect(d.toCreate).toEqual([]);
  });

  it("ne supprime JAMAIS une ouverture d'une autre semaine", () => {
    const autreSemaine = opening({ id: "o9", date: "2026-10-01" });
    const d = diffOpenings([opening({}), autreSemaine], [band({})], DAYS);
    expect(d.toDelete).toEqual([]);
  });

  it("tout effacer supprime toutes les ouvertures visibles, et elles seules", () => {
    const d = diffOpenings(
      [opening({ id: "a" }), opening({ id: "b", room: "217" }), opening({ id: "c", date: "2026-10-01" })],
      [],
      DAYS,
    );
    expect(d.toDelete.sort()).toEqual(["a", "b"]);
  });

  it("détecte un changement de salle", () => {
    const d = diffOpenings([opening({})], [band({ laneId: "219" })], DAYS);
    expect(d.toUpdate[0].room).toBe("219");
  });

  it("écarte une bande dont la colonne n'existe pas", () => {
    const d = diffOpenings([], [band({ id: "x", dayIndex: 12 })], DAYS);
    expect(d.toCreate).toEqual([]);
  });
});
