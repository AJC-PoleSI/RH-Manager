import { describe, it, expect } from "vitest";
import { planReclaims, type ReclaimSlot } from "./dispatch-reclaim";

const slot = (over: Partial<ReclaimSlot> & { id: string }): ReclaimSlot => ({
  date: "2026-09-17",
  start_time: "16:30",
  end_time: "16:55",
  room: "205",
  minMembers: 2,
  candidates: 0,
  wipeable: true,
  frozen: false,
  roulementMinutes: 5,
  ...over,
});

const juryOf = (entries: Array<[string, string[]]>) =>
  new Map(entries.map(([id, members]) => [id, new Set(members)]));

describe("planReclaims — cas réel du 17/09/2026 16h30", () => {
  it("complète la salle à candidat en prenant chez la salle vide", () => {
    const slots = [
      slot({ id: "219", room: "219", candidates: 1 }),
      slot({ id: "205", room: "205", candidates: 0 }),
    ];
    const jury = juryOf([
      ["219", ["clara"]],
      ["205", ["amandine", "maeva"]],
    ]);

    const moves = planReclaims({
      slots,
      juryBySlot: jury,
      eligibleFor: () => new Set(["clara", "amandine", "maeva"]),
    });

    expect(moves).toHaveLength(1);
    expect(moves[0].toSlotId).toBe("219");
    expect(moves[0].fromSlotId).toBe("205");
    expect(jury.get("219")!.size).toBe(2);
    // Le donneur tombe sous son minimum : assumé, il n'a aucun candidat.
    expect(jury.get("205")!.size).toBe(1);
  });

  it("préfère le donneur le plus fourni", () => {
    const slots = [
      slot({ id: "219", room: "219", candidates: 1 }),
      slot({ id: "205", room: "205" }),
      slot({ id: "217", room: "217" }),
    ];
    const jury = juryOf([
      ["219", ["clara"]],
      ["205", ["a"]],
      ["217", ["b", "c", "d"]],
    ]);

    const moves = planReclaims({
      slots,
      juryBySlot: jury,
      eligibleFor: () => new Set(["a", "b", "c", "d"]),
    });

    expect(moves[0].fromSlotId).toBe("217");
    expect(jury.get("205")!.size).toBe(1);
  });
});

describe("planReclaims — ce à quoi on ne touche pas", () => {
  it("ne prend JAMAIS sur un créneau où un candidat est inscrit", () => {
    const slots = [
      slot({ id: "219", room: "219", candidates: 1 }),
      slot({ id: "205", room: "205", candidates: 2 }),
    ];
    const jury = juryOf([
      ["219", ["clara"]],
      ["205", ["amandine", "maeva"]],
    ]);

    expect(
      planReclaims({
        slots,
        juryBySlot: jury,
        eligibleFor: () => new Set(["amandine", "maeva"]),
      }),
    ).toEqual([]);
  });

  // Un créneau clôturé / à jury manuel / gelé n'est pas réécrit en base :
  // retirer quelqu'un en mémoire le laisserait sur les DEUX créneaux.
  it("ne prend pas sur un créneau que le run ne réécrit pas", () => {
    const slots = [
      slot({ id: "219", room: "219", candidates: 1 }),
      slot({ id: "205", room: "205", wipeable: false }),
    ];
    const jury = juryOf([
      ["219", ["clara"]],
      ["205", ["amandine", "maeva"]],
    ]);

    expect(
      planReclaims({
        slots,
        juryBySlot: jury,
        eligibleFor: () => new Set(["amandine", "maeva"]),
      }),
    ).toEqual([]);
  });

  it("ne prend pas sur un créneau gelé (moins de 24h)", () => {
    const slots = [
      slot({ id: "219", room: "219", candidates: 1 }),
      slot({ id: "205", room: "205", frozen: true }),
    ];
    const jury = juryOf([
      ["219", ["clara"]],
      ["205", ["amandine", "maeva"]],
    ]);

    expect(
      planReclaims({
        slots,
        juryBySlot: jury,
        eligibleFor: () => new Set(["amandine", "maeva"]),
      }),
    ).toEqual([]);
  });

  it("ne déplace personne dont la disponibilité ne couvre pas le créneau", () => {
    const slots = [
      slot({ id: "219", room: "219", candidates: 1 }),
      slot({ id: "205", room: "205" }),
    ];
    const jury = juryOf([
      ["219", ["clara"]],
      ["205", ["amandine", "maeva"]],
    ]);

    expect(
      planReclaims({
        slots,
        juryBySlot: jury,
        eligibleFor: () => new Set<string>(), // personne ne couvre 219
      }),
    ).toEqual([]);
  });

  it("ne touche pas à un créneau receveur déjà complet", () => {
    const slots = [
      slot({ id: "219", room: "219", candidates: 1 }),
      slot({ id: "205", room: "205" }),
    ];
    const jury = juryOf([
      ["219", ["clara", "esther"]],
      ["205", ["amandine", "maeva"]],
    ]);

    expect(
      planReclaims({
        slots,
        juryBySlot: jury,
        eligibleFor: () => new Set(["amandine", "maeva"]),
      }),
    ).toEqual([]);
  });

  // Le donneur doit BLOQUER le receveur : sans chevauchement ni contrainte de
  // roulement, l'examinateur était déjà libre de prendre le créneau —
  // l'allocation l'aurait fait, il n'y a rien à reprendre.
  it("ne prend pas sur un créneau d'un autre horaire sans contrainte", () => {
    const slots = [
      slot({ id: "219", room: "219", candidates: 1 }),
      slot({ id: "205", room: "205", start_time: "09:00", end_time: "09:25" }),
    ];
    const jury = juryOf([
      ["219", ["clara"]],
      ["205", ["amandine", "maeva"]],
    ]);

    expect(
      planReclaims({
        slots,
        juryBySlot: jury,
        eligibleFor: () => new Set(["amandine", "maeva"]),
      }),
    ).toEqual([]);
  });
});

describe("planReclaims — cohérence des déplacements", () => {
  // Reprendre quelqu'un ne doit pas créer le conflit qu'on vient de résoudre
  // ailleurs : Business Game à 16h55 dans une autre salle, 0 min pour changer.
  it("ne déplace pas un membre engagé sur un 3e créneau incompatible", () => {
    const slots = [
      slot({ id: "219", room: "219", candidates: 1 }),
      slot({ id: "205", room: "205" }),
      slot({
        id: "bg",
        room: "235",
        start_time: "16:55",
        end_time: "17:40",
        candidates: 3,
        roulementMinutes: 10,
        minMembers: 6,
      }),
    ];
    const jury = juryOf([
      ["219", ["clara"]],
      ["205", ["amandine", "emilie"]],
      ["bg", ["emilie"]],
    ]);

    const moves = planReclaims({
      slots,
      juryBySlot: jury,
      eligibleFor: () => new Set(["amandine", "emilie"]),
    });

    // Emilie enchaîne sur le Business Game : intouchable. Amandine part.
    expect(moves).toHaveLength(1);
    expect(moves[0].memberId).toBe("amandine");
    expect(jury.get("bg")!.has("emilie")).toBe(true);
  });

  it("sert d'abord le créneau le plus dégarni", () => {
    const slots = [
      slot({ id: "a", room: "A", candidates: 1, minMembers: 2 }), // manque 1
      slot({ id: "b", room: "B", candidates: 1, minMembers: 3 }), // manque 2
      slot({ id: "vide", room: "V", minMembers: 6 }),
    ];
    const jury = juryOf([
      ["a", ["x"]],
      ["b", ["y"]],
      ["vide", ["p", "q"]],
    ]);

    const moves = planReclaims({
      slots,
      juryBySlot: jury,
      eligibleFor: () => new Set(["p", "q"]),
    });

    expect(moves[0].toSlotId).toBe("b");
    expect(jury.get("b")!.size).toBe(3 - 1 + 1); // b a reçu les deux restants
    expect(jury.get("a")!.size).toBe(1); // plus rien pour a
  });

  it("s'arrête proprement quand il n'y a plus rien à reprendre", () => {
    const slots = [
      slot({ id: "219", room: "219", candidates: 1, minMembers: 4 }),
      slot({ id: "205", room: "205" }),
    ];
    const jury = juryOf([
      ["219", ["clara"]],
      ["205", ["amandine"]],
    ]);

    const moves = planReclaims({
      slots,
      juryBySlot: jury,
      eligibleFor: () => new Set(["amandine"]),
    });

    expect(moves).toHaveLength(1);
    expect(jury.get("205")!.size).toBe(0);
    expect(jury.get("219")!.size).toBe(2); // reste incomplet, sans boucler
  });
});

describe("planReclaims — engagements hors périmètre (run scopé à une épreuve)", () => {
  // Audit du 12/09/2026 : sur un run limité à une épreuve, les affectations
  // des AUTRES épreuves ne sont pas dans juryBySlot. La reprise pouvait donc
  // déplacer un examinateur vers un créneau qui chevauche (ou enchaîne sans
  // roulement avec) une affectation qu'il garde ailleurs → double réservation.
  it("ne reprend pas un examinateur engagé ailleurs au même moment", () => {
    const slots = [
      slot({ id: "R", room: "219", start_time: "16:45", end_time: "17:10", candidates: 1 }),
      slot({ id: "D", room: "205", start_time: "16:30", end_time: "16:55" }),
    ];
    const jury = juryOf([
      ["R", ["clara"]],
      ["D", ["m"]],
    ]);
    const fixed = new Map([
      [
        "m",
        [
          {
            date: "2026-09-17",
            start: "17:00",
            end: "17:25",
            room: "300",
            roulementMinutes: 5,
          },
        ],
      ],
    ]);

    const moves = planReclaims({
      slots,
      juryBySlot: jury,
      eligibleFor: () => new Set(["m"]),
      fixedCommitments: fixed,
    });

    expect(moves).toHaveLength(0);
    expect(jury.get("D")!.has("m")).toBe(true);
    expect(jury.get("R")!.size).toBe(1);
  });

  it("reprend normalement quand l'engagement externe ne bloque pas", () => {
    const slots = [
      slot({ id: "R", room: "219", candidates: 1 }),
      slot({ id: "D", room: "205" }),
    ];
    const jury = juryOf([
      ["R", ["clara"]],
      ["D", ["m"]],
    ]);
    const fixed = new Map([
      [
        "m",
        [{ date: "2026-09-18", start: "16:30", end: "16:55", room: "300", roulementMinutes: 5 }],
      ],
    ]);

    const moves = planReclaims({
      slots,
      juryBySlot: jury,
      eligibleFor: () => new Set(["m"]),
      fixedCommitments: fixed,
    });

    expect(moves).toHaveLength(1);
    expect(jury.get("R")!.has("m")).toBe(true);
  });
});
