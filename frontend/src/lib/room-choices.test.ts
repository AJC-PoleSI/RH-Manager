import { describe, it, expect } from "vitest";
import { roomChoicesForSlot, isEmptySlot, type RoomChoiceSlot } from "./room-choices";

const slot = (
  id: string,
  room: string,
  start: string,
  end: string,
  opts: { date?: string; members?: number; candidates?: number } = {},
): RoomChoiceSlot => ({
  id,
  room,
  date: opts.date ?? "2026-09-21T12:00:00.000Z",
  start_time: start,
  end_time: end,
  members: Array.from({ length: opts.members ?? 0 }, (_, i) => ({ id: `m${i}` })),
  enrollments: Array.from({ length: opts.candidates ?? 0 }, (_, i) => ({ id: `c${i}` })),
});

/** Le créneau à déplacer : 08:30–08:55 en salle 205, 1 examinateur, 1 inscrit. */
const courant = slot("cur", "205", "08:30", "08:55", { members: 1, candidates: 1 });

const roomState = (all: RoomChoiceSlot[], room: string) =>
  roomChoicesForSlot(all, courant).day.find((d) => d.room === room);

describe("salle libre", () => {
  it("aucun créneau sur l'horaire → libre", () => {
    expect(roomState([courant, slot("a", "217", "10:00", "10:25")], "217")).toEqual({
      room: "217",
      busy: false,
      swap: false,
    });
  });

  it("horaires jointifs → libre (08:55 enchaîne 08:30–08:55)", () => {
    expect(roomState([courant, slot("a", "217", "08:55", "09:20")], "217")?.busy).toBe(false);
  });

  it("sa propre salle n'est pas occupée par elle-même", () => {
    expect(roomState([courant], "205")).toEqual({ room: "205", busy: false, swap: false });
  });
});

describe("échange — le cas remonté par Felix le 12/09/2026", () => {
  it("créneau VIDE au même horaire → échange possible, pas « occupée »", () => {
    expect(roomState([courant, slot("a", "217", "08:30", "08:55")], "217")).toEqual({
      room: "217",
      busy: false,
      swap: true,
    });
  });

  it("un examinateur affecté suffit à bloquer", () => {
    expect(roomState([courant, slot("a", "217", "08:30", "08:55", { members: 1 })], "217")).toEqual(
      { room: "217", busy: true, swap: false },
    );
  });

  it("un candidat inscrit suffit à bloquer", () => {
    expect(
      roomState([courant, slot("a", "217", "08:30", "08:55", { candidates: 1 })], "217"),
    ).toEqual({ room: "217", busy: true, swap: false });
  });

  it("vide mais horaire décalé → occupée (l'échange déplacerait ce créneau ailleurs)", () => {
    expect(roomState([courant, slot("a", "217", "08:15", "08:45")], "217")).toEqual({
      room: "217",
      busy: true,
      swap: false,
    });
  });

  it("vide mais plus long → occupée", () => {
    expect(roomState([courant, slot("a", "217", "08:30", "09:30")], "217")?.swap).toBe(false);
  });

  it("deux créneaux vides superposés → occupée, l'échange ne sait pas trancher", () => {
    const all = [
      courant,
      slot("a", "217", "08:30", "08:55"),
      slot("b", "217", "08:40", "09:05"),
    ];
    expect(roomState(all, "217")).toEqual({ room: "217", busy: true, swap: false });
  });

  it("sa propre salle passe en échange si un créneau vide s'y superpose", () => {
    expect(roomState([courant, slot("dbl", "205", "08:30", "08:55")], "205")?.swap).toBe(true);
  });
});

describe("liste des salles", () => {
  it("trie naturellement les salles du jour", () => {
    const all = [courant, slot("a", "2", "10:00", "10:25"), slot("b", "217", "10:00", "10:25")];
    expect(roomChoicesForSlot(all, courant).day.map((d) => d.room)).toEqual(["2", "205", "217"]);
  });

  it("propose les salles des autres jours sans état d'occupation", () => {
    const all = [courant, slot("a", "310", "08:30", "08:55", { date: "2026-09-22T12:00:00.000Z" })];
    expect(roomChoicesForSlot(all, courant).others).toEqual(["310"]);
  });

  it("ne répète pas dans « autres » une salle déjà listée pour le jour", () => {
    const all = [
      courant,
      slot("a", "205", "08:30", "08:55", { date: "2026-09-22T12:00:00.000Z" }),
    ];
    const r = roomChoicesForSlot(all, courant);
    expect(r.others).toEqual([]);
    expect(r.day.map((d) => d.room)).toEqual(["205"]);
  });

  it("une salle du jour sans chevauchement reste proposée", () => {
    const all = [courant, slot("a", "235", "14:00", "14:25")];
    expect(roomChoicesForSlot(all, courant).day.map((d) => d.room)).toEqual(["205", "235"]);
  });

  it("ignore les créneaux sans salle", () => {
    expect(roomChoicesForSlot([courant, slot("a", "  ", "08:30", "08:55")], courant).day).toEqual([
      { room: "205", busy: false, swap: false },
    ]);
  });

  it("tolère les horaires au format HH:MM:SS", () => {
    expect(roomState([courant, slot("a", "217", "08:30:00", "08:55:00")], "217")?.swap).toBe(true);
  });
});

describe("cas dégradés", () => {
  it("pas de créneau ouvert → listes vides", () => {
    expect(roomChoicesForSlot([courant], null)).toEqual({ day: [], others: [] });
  });

  it("planning pas encore chargé → listes vides", () => {
    expect(roomChoicesForSlot(undefined, courant)).toEqual({ day: [], others: [] });
  });

  it("isEmptySlot tolère des champs absents", () => {
    expect(isEmptySlot({ id: "x" })).toBe(true);
  });
});
