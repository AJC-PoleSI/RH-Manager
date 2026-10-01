import { describe, it, expect } from "vitest";
import {
  generateTourSlots,
  chargeParPersonne,
  type GeneratorEpreuve,
} from "./tour-generator";

const win = (memberId: string, startMin: number, endMin: number) => ({
  memberId,
  startMin,
  endMin,
});

const ep = (
  o: Partial<GeneratorEpreuve> & { epreuveId: string },
): GeneratorEpreuve => ({
  name: o.epreuveId,
  isGroupEpreuve: false,
  evaluatorsPerRoom: 2,
  slotSpanMin: 30,
  targetSlots: 10,
  eligibleMembers: [],
  ...o,
});

const day = (
  windows: ReturnType<typeof win>[],
  extra: Partial<{
    dayIndex: number;
    busy: { memberId: string; startMin: number; endMin: number }[];
    roomsTaken: { room: string; startMin: number; endMin: number }[];
  }> = {},
) => ({ dayIndex: 0, windows, busy: [], roomsTaken: [], ...extra });

describe("chargeParPersonne", () => {
  it("places de jury à pourvoir ÷ membres éligibles", () => {
    expect(
      chargeParPersonne({ remaining: 40, evaluatorsPerRoom: 2, eligibleCount: 4 }),
    ).toBe(20);
  });

  it("sans membre éligible → infini (sert à alerter, jamais à générer)", () => {
    expect(
      chargeParPersonne({ remaining: 1, evaluatorsPerRoom: 2, eligibleCount: 0 }),
    ).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("generateTourSlots", () => {
  it("une épreuve de pôle ne consomme que les membres de son pôle", () => {
    const r = generateTourSlots({
      rooms: ["205", "217"],
      days: [
        day([
          win("devco1", 540, 660),
          win("devco2", 540, 660),
          win("mkt1", 540, 660),
        ]),
      ],
      epreuves: [
        ep({ epreuveId: "devco", eligibleMembers: ["devco1", "devco2"], targetSlots: 4 }),
      ],
    });
    expect(r.bandsByEpreuve.devco).toHaveLength(1);
    expect(r.bandsByEpreuve.devco[0]).toMatchObject({
      laneId: "205",
      startMin: 540,
      endMin: 660,
    });
    expect(r.remainingByEpreuve.devco).toBe(0);
    expect(r.reasonByEpreuve.devco).toBe("ok");
  });

  it("un membre n'est jamais compté deux fois au même horaire", () => {
    // Tom et Léa sont les seuls Dev Co disponibles ; le Business Game (tout
    // le monde) ne doit pas les réutiliser sur la même tranche.
    const r = generateTourSlots({
      rooms: ["205", "217", "219"],
      days: [
        day([
          win("tom", 540, 600),
          win("lea", 540, 600),
          win("a", 540, 600),
          win("b", 540, 600),
          win("c", 540, 600),
        ]),
      ],
      epreuves: [
        ep({ epreuveId: "devco", eligibleMembers: ["tom", "lea"], targetSlots: 2 }),
        ep({
          epreuveId: "bg",
          isGroupEpreuve: true,
          evaluatorsPerRoom: 4,
          slotSpanMin: 60,
          eligibleMembers: ["tom", "lea", "a", "b", "c"],
          targetSlots: 1,
        }),
      ],
    });
    expect(r.bandsByEpreuve.devco).toHaveLength(1);
    // Il ne reste que a, b, c (3 < 4) : pas de Business Game possible.
    expect(r.bandsByEpreuve.bg).toHaveLength(0);
    expect(r.reasonByEpreuve.bg).toBe("no_members");
  });

  it("priorité à la charge par personne la plus forte, recalculée", () => {
    // SI : 1 créneau pour 2 membres (charge 1) ; Dev Co : 6 créneaux pour 2
    // membres (charge 6). « x » est le seul membre commun : Dev Co le prend.
    const r = generateTourSlots({
      rooms: ["205"],
      days: [day([win("x", 540, 570), win("y", 540, 570), win("z", 540, 570)])],
      epreuves: [
        ep({ epreuveId: "si", eligibleMembers: ["x", "z"], targetSlots: 1 }),
        ep({ epreuveId: "devco", eligibleMembers: ["x", "y"], targetSlots: 6 }),
      ],
    });
    expect(r.bandsByEpreuve.devco).toHaveLength(1);
    expect(r.bandsByEpreuve.si).toHaveLength(0);
  });

  it("une fois Dev Co en bonne voie, la priorité bascule", () => {
    // Deux épreuves à 1 créneau chacune, un membre commun « x » : sur la
    // première tranche Dev Co (charge égale, moins de membres éligibles ?
    // non : mêmes effectifs) → ordre d'entrée ; une fois Dev Co comblée, SI
    // est servie à la tranche suivante avec x.
    const r = generateTourSlots({
      rooms: ["205", "217"],
      days: [day([win("x", 540, 600), win("y", 540, 600), win("z", 540, 600)])],
      epreuves: [
        ep({ epreuveId: "devco", eligibleMembers: ["x", "y"], targetSlots: 1 }),
        ep({ epreuveId: "si", eligibleMembers: ["x", "z"], targetSlots: 1 }),
      ],
    });
    expect(r.bandsByEpreuve.devco).toHaveLength(1);
    expect(r.bandsByEpreuve.si).toHaveLength(1);
    expect(r.remainingByEpreuve.devco).toBe(0);
    expect(r.remainingByEpreuve.si).toBe(0);
  });

  it("une salle déjà prise (créneau existant) n'est pas réutilisée", () => {
    const r = generateTourSlots({
      rooms: ["205"],
      days: [
        day([win("a", 540, 600), win("b", 540, 600)], {
          roomsTaken: [{ room: "205", startMin: 540, endMin: 600 }],
        }),
      ],
      epreuves: [ep({ epreuveId: "devco", eligibleMembers: ["a", "b"], targetSlots: 2 })],
    });
    expect(r.bandsByEpreuve.devco).toHaveLength(0);
    expect(r.reasonByEpreuve.devco).toBe("no_rooms");
  });

  it("un membre déjà affecté ailleurs (busy) n'est pas réservé", () => {
    const r = generateTourSlots({
      rooms: ["205"],
      days: [
        day([win("a", 540, 600), win("b", 540, 600)], {
          busy: [{ memberId: "a", startMin: 540, endMin: 570 }],
        }),
      ],
      epreuves: [ep({ epreuveId: "devco", eligibleMembers: ["a", "b"], targetSlots: 2 })],
    });
    // 9h00–9h30 : a occupé → rien ; 9h30–10h00 : a et b libres → 1 créneau.
    expect(r.bandsByEpreuve.devco).toEqual([
      expect.objectContaining({ startMin: 570, endMin: 600 }),
    ]);
  });

  it("s'arrête net quand la cible est atteinte", () => {
    const r = generateTourSlots({
      rooms: ["205", "217"],
      days: [
        day([
          win("a", 540, 780),
          win("b", 540, 780),
          win("c", 540, 780),
          win("d", 540, 780),
        ]),
      ],
      epreuves: [
        ep({ epreuveId: "devco", eligibleMembers: ["a", "b", "c", "d"], targetSlots: 3 }),
      ],
    });
    const produced = r.bandsByEpreuve.devco.reduce(
      (s, b) => s + Math.floor((b.endMin - b.startMin) / 30),
      0,
    );
    expect(produced).toBe(3);
    expect(r.remainingByEpreuve.devco).toBe(0);
  });

  it("respecte la période de l'épreuve (jours et heures de journée)", () => {
    const r = generateTourSlots({
      rooms: ["205"],
      days: [
        day([win("a", 540, 600), win("b", 540, 600)], { dayIndex: 0 }),
        day([win("a", 540, 600), win("b", 540, 600)], { dayIndex: 1 }),
      ],
      epreuves: [
        ep({
          epreuveId: "devco",
          eligibleMembers: ["a", "b"],
          targetSlots: 4,
          dayIndexes: [1],
          dayStartMin: 570,
          dayEndMin: 600,
        }),
      ],
    });
    expect(r.bandsByEpreuve.devco).toEqual([
      expect.objectContaining({ dayIndex: 1, startMin: 570, endMin: 600 }),
    ]);
  });

  it("épreuve sans aucun membre éligible → alerte, rien de généré", () => {
    const r = generateTourSlots({
      rooms: ["205"],
      days: [day([win("a", 540, 600)])],
      epreuves: [ep({ epreuveId: "treso", eligibleMembers: [], targetSlots: 2 })],
    });
    expect(r.bandsByEpreuve.treso).toHaveLength(0);
    expect(r.reasonByEpreuve.treso).toBe("no_eligible");
  });

  it("garde le même équipage d'une tranche à la suivante sur une même salle", () => {
    // Créneau de 60 min (2 tranches) : a et b commencent ; c et d sont aussi
    // là. On attend une seule plage 9h00–10h00, pas un changement d'équipage
    // qui couperait la plage en deux.
    const r = generateTourSlots({
      rooms: ["205"],
      days: [
        day([
          win("a", 540, 600),
          win("b", 540, 600),
          win("c", 540, 600),
          win("d", 540, 600),
        ]),
      ],
      epreuves: [
        ep({
          epreuveId: "devco",
          eligibleMembers: ["a", "b", "c", "d"],
          targetSlots: 1,
          slotSpanMin: 60,
        }),
      ],
    });
    expect(r.bandsByEpreuve.devco).toEqual([
      expect.objectContaining({ startMin: 540, endMin: 600 }),
    ]);
  });
});
