import { describe, it, expect } from "vitest";
import {
  slotGroupKey,
  pickPackedRoom,
  regroupEnrollments,
  type RoomOption,
} from "./room-packing";

const room = (
  slotId: string,
  enrolledCount: number,
  capacity = 1,
  juryInPlace = true,
): RoomOption => ({ slotId, room: slotId, enrolledCount, capacity, juryInPlace });

describe("slotGroupKey", () => {
  it("regroupe deux salles de la même épreuve au même horaire", () => {
    const a = {
      epreuve_id: "ep1",
      date: "2026-09-21T00:00:00.000Z",
      start_time: "08:30:00",
      end_time: "08:55:00",
    };
    const b = { ...a };
    expect(slotGroupKey(a)).toBe(slotGroupKey(b));
  });

  it("ne regroupe pas deux horaires différents", () => {
    const base = { epreuve_id: "ep1", date: "2026-09-21", end_time: "08:55" };
    expect(slotGroupKey({ ...base, start_time: "08:30" })).not.toBe(
      slotGroupKey({ ...base, start_time: "09:00" }),
    );
  });

  it("ne regroupe pas deux épreuves différentes au même horaire", () => {
    const base = { date: "2026-09-21", start_time: "08:30", end_time: "08:55" };
    expect(slotGroupKey({ ...base, epreuve_id: "ep1" })).not.toBe(
      slotGroupKey({ ...base, epreuve_id: "ep2" }),
    );
  });
});

describe("pickPackedRoom", () => {
  it("remplit une salle déjà entamée plutôt que d'en ouvrir une neuve", () => {
    const pick = pickPackedRoom([
      room("vide", 0, 6),
      room("entamee", 2, 6),
    ]);
    expect(pick?.slotId).toBe("entamee");
  });

  it("prend la salle la PLUS remplie pour en finir une avant d'en ouvrir une autre", () => {
    const pick = pickPackedRoom([
      room("peu", 1, 6),
      room("presque-pleine", 5, 6),
      room("moyenne", 3, 6),
    ]);
    expect(pick?.slotId).toBe("presque-pleine");
  });

  it("n'attribue jamais une salle pleine", () => {
    const pick = pickPackedRoom([room("pleine", 1, 1), room("libre", 0, 1)]);
    expect(pick?.slotId).toBe("libre");
  });

  it("à égalité, préfère la salle où le jury est déjà en place", () => {
    const pick = pickPackedRoom([
      room("sans-jury", 0, 1, false),
      room("avec-jury", 0, 1, true),
    ]);
    expect(pick?.slotId).toBe("avec-jury");
  });

  it("renvoie null quand tout est plein", () => {
    expect(pickPackedRoom([room("a", 1, 1), room("b", 6, 6)])).toBeNull();
  });

  it("renvoie null sans aucune salle", () => {
    expect(pickPackedRoom([])).toBeNull();
  });

  it("est déterministe à égalité stricte", () => {
    const options = [room("zzz", 0, 1), room("aaa", 0, 1)];
    expect(pickPackedRoom(options)?.slotId).toBe("aaa");
    expect(pickPackedRoom([...options].reverse())?.slotId).toBe("aaa");
  });
});

describe("regroupEnrollments", () => {
  it("deux candidats au même horaire ont besoin de deux salles : on ne bouge personne", () => {
    const moves = regroupEnrollments(
      [room("217", 1, 1), room("205", 1, 1)],
      new Map([
        ["217", ["candidat-a"]],
        ["205", ["candidat-b"]],
      ]),
    );
    expect(moves).toEqual([]);
  });

  it("déplace le candidat seul vers la salle où le jury est déjà en place — cas du 21/09", () => {
    // Un seul candidat à cet horaire. Il s'est inscrit en 205, qui n'a pas de
    // jury, alors que l'équipe enchaîne déjà en 217 : c'est le candidat qu'on
    // déplace, pas les deux examinateurs.
    const moves = regroupEnrollments(
      [
        { slotId: "205", room: "205", enrolledCount: 1, capacity: 1, juryInPlace: false },
        { slotId: "217", room: "217", enrolledCount: 0, capacity: 1, juryInPlace: true },
      ],
      new Map([
        ["205", ["candidat-a"]],
        ["217", []],
      ]),
    );
    expect(moves).toEqual([
      { candidateId: "candidat-a", fromSlotId: "205", toSlotId: "217" },
    ]);
  });

  it("ne déplace pas un candidat déjà dans la salle du jury", () => {
    const moves = regroupEnrollments(
      [
        { slotId: "217", room: "217", enrolledCount: 1, capacity: 1, juryInPlace: true },
        { slotId: "205", room: "205", enrolledCount: 0, capacity: 1, juryInPlace: false },
      ],
      new Map([
        ["217", ["candidat-a"]],
        ["205", []],
      ]),
    );
    expect(moves).toEqual([]);
  });

  it("ne déplace personne si aucune salle n'a de jury (rien ne distingue les salles)", () => {
    const moves = regroupEnrollments(
      [
        { slotId: "205", room: "205", enrolledCount: 1, capacity: 1, juryInPlace: false },
        { slotId: "217", room: "217", enrolledCount: 0, capacity: 1, juryInPlace: false },
      ],
      new Map([
        ["205", ["candidat-a"]],
        ["217", []],
      ]),
    );
    expect(moves).toEqual([]);
  });

  it("vide la salle la plus creuse vers celle qui a de la place (épreuve de groupe)", () => {
    const moves = regroupEnrollments(
      [room("235", 4, 6), room("238-240", 1, 6)],
      new Map([
        ["235", ["a", "b", "c", "d"]],
        ["238-240", ["e"]],
      ]),
    );
    expect(moves).toEqual([
      { candidateId: "e", fromSlotId: "238-240", toSlotId: "235" },
    ]);
  });

  it("ne déplace personne si la salle conservée n'a pas assez de place", () => {
    const moves = regroupEnrollments(
      [room("235", 6, 6), room("238-240", 2, 6)],
      new Map([
        ["235", ["a", "b", "c", "d", "e", "f"]],
        ["238-240", ["g", "h"]],
      ]),
    );
    expect(moves).toEqual([]);
  });

  it("ne dérange personne quand le déplacement ne libère aucune salle", () => {
    // 7 candidats pour des salles de 6 : il faut deux salles de toute façon.
    // Passer de 5+2 à 6+1 n'économise rien et déplace quelqu'un pour rien.
    const moves = regroupEnrollments(
      [room("235", 5, 6), room("238-240", 2, 6)],
      new Map([
        ["235", ["a", "b", "c", "d", "e"]],
        ["238-240", ["g", "h"]],
      ]),
    );
    expect(moves).toEqual([]);
  });

  it("regroupe trois salles creuses sur une seule", () => {
    const moves = regroupEnrollments(
      [room("A", 2, 6), room("B", 1, 6), room("C", 1, 6)],
      new Map([
        ["A", ["a1", "a2"]],
        ["B", ["b1"]],
        ["C", ["c1"]],
      ]),
    );
    expect(moves).toHaveLength(2);
    expect(moves.every((m) => m.toSlotId === "A")).toBe(true);
  });

  it("ne touche à rien quand une seule salle est ouverte", () => {
    expect(
      regroupEnrollments([room("A", 3, 6)], new Map([["A", ["a", "b", "c"]]])),
    ).toEqual([]);
  });
});
