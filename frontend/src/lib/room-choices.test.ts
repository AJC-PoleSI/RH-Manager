import { describe, it, expect } from "vitest";
import { roomChoicesForSlot, type RoomChoiceSlot } from "./room-choices";

const slot = (
  id: string,
  room: string,
  start: string,
  end: string,
  date = "2026-09-15T12:00:00.000Z",
): RoomChoiceSlot => ({ id, room, date, start_time: start, end_time: end });

/** Le créneau que l'admin veut déplacer : 14:00–14:30 en salle 204. */
const courant = slot("cur", "204", "14:00", "14:30");

describe("salles du jour", () => {
  it("liste les salles utilisées ce jour-là, triées naturellement", () => {
    const r = roomChoicesForSlot(
      [courant, slot("a", "210", "09:00", "09:30"), slot("b", "2", "09:00", "09:30")],
      courant,
    );
    expect(r.day.map((d) => d.room)).toEqual(["2", "204", "210"]);
  });

  it("marque occupée une salle qui a un créneau sur le même horaire", () => {
    const r = roomChoicesForSlot([courant, slot("a", "210", "14:15", "14:45")], courant);
    expect(r.day.find((d) => d.room === "210")?.busy).toBe(true);
  });

  it("laisse libre une salle dont les créneaux sont ailleurs dans la journée", () => {
    const r = roomChoicesForSlot([courant, slot("a", "210", "15:00", "15:30")], courant);
    expect(r.day.find((d) => d.room === "210")?.busy).toBe(false);
  });

  it("traite les horaires jointifs comme libres (14:30 enchaîne 14:00–14:30)", () => {
    const r = roomChoicesForSlot([courant, slot("a", "210", "14:30", "15:00")], courant);
    expect(r.day.find((d) => d.room === "210")?.busy).toBe(false);
  });

  it("n'affiche pas la salle du créneau occupée par le créneau lui-même", () => {
    const r = roomChoicesForSlot([courant], courant);
    expect(r.day).toEqual([{ room: "204", busy: false }]);
  });

  it("affiche occupée sa propre salle si un AUTRE créneau s'y superpose (l'incohérence à corriger)", () => {
    const r = roomChoicesForSlot([courant, slot("dbl", "204", "14:00", "14:30")], courant);
    expect(r.day.find((d) => d.room === "204")?.busy).toBe(true);
  });

  it("une salle reste occupée même si ses autres créneaux du jour sont libres", () => {
    const r = roomChoicesForSlot(
      [courant, slot("a", "210", "09:00", "09:30"), slot("b", "210", "14:10", "14:20")],
      courant,
    );
    expect(r.day.find((d) => d.room === "210")?.busy).toBe(true);
  });

  it("ignore les créneaux sans salle", () => {
    const r = roomChoicesForSlot([courant, slot("a", "  ", "14:00", "14:30")], courant);
    expect(r.day.map((d) => d.room)).toEqual(["204"]);
  });

  it("tolère des horaires au format HH:MM:SS", () => {
    const r = roomChoicesForSlot(
      [courant, { ...slot("a", "210", "14:00:00", "14:30:00") }],
      courant,
    );
    expect(r.day.find((d) => d.room === "210")?.busy).toBe(true);
  });
});

describe("autres salles du planning", () => {
  it("propose les salles des autres jours, sans marqueur d'occupation", () => {
    const r = roomChoicesForSlot(
      [courant, slot("a", "310", "14:00", "14:30", "2026-09-16T12:00:00.000Z")],
      courant,
    );
    expect(r.others).toEqual(["310"]);
  });

  it("ne répète pas dans « autres » une salle déjà listée pour le jour", () => {
    const r = roomChoicesForSlot(
      [courant, slot("a", "204", "09:00", "09:30", "2026-09-16T12:00:00.000Z")],
      courant,
    );
    expect(r.others).toEqual([]);
    expect(r.day.map((d) => d.room)).toEqual(["204"]);
  });
});

describe("cas dégradés", () => {
  it("renvoie des listes vides sans créneau ouvert", () => {
    expect(roomChoicesForSlot([courant], null)).toEqual({ day: [], others: [] });
  });

  it("renvoie des listes vides si le planning n'est pas encore chargé", () => {
    expect(roomChoicesForSlot(undefined, courant)).toEqual({ day: [], others: [] });
  });
});
