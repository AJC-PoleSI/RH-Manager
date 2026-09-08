import { describe, it, expect } from "vitest";
import {
  pairKey,
  timeOverlaps,
  availabilityMatchesSlot,
  isFrozen,
  scoreMember,
  compareByTension,
  slotTension,
  epreuveShortfall,
  roomStreak,
  orderPredecessorsFirst,
  ROOM_STREAK_MAX,
} from "./dispatch-core";

describe("pairKey", () => {
  it("est indépendante de l'ordre des membres", () => {
    expect(pairKey("a", "b")).toBe(pairKey("b", "a"));
  });
});

describe("timeOverlaps", () => {
  it("détecte un chevauchement", () => {
    expect(timeOverlaps("12:00", "13:00", "12:05", "12:50")).toBe(true);
  });
  it("ne chevauche pas si adjacent (fin == début)", () => {
    expect(timeOverlaps("11:00", "11:20", "11:20", "11:40")).toBe(false);
  });
  it("ne chevauche pas si disjoint", () => {
    expect(timeOverlaps("09:00", "10:00", "11:00", "12:00")).toBe(false);
  });
});

describe("availabilityMatchesSlot", () => {
  const slot = { date: "2026-06-22", start_time: "12:05", end_time: "12:50" };

  it("matche une dispo qui englobe le créneau (group épreuve sous-staffée résolu)", () => {
    const av = { date: "2026-06-22", start_time: "12:00", end_time: "13:00" };
    expect(availabilityMatchesSlot(av, slot)).toBe(true);
  });

  it("ne matche pas un autre jour", () => {
    const av = { date: "2026-06-23", start_time: "12:00", end_time: "13:00" };
    expect(availabilityMatchesSlot(av, slot)).toBe(false);
  });

  it("ne matche pas une dispo disjointe le même jour", () => {
    const av = { date: "2026-06-22", start_time: "09:00", end_time: "10:00" };
    expect(availabilityMatchesSlot(av, slot)).toBe(false);
  });

  it("repli rétro-compatible sur l'égalité d'heure de début si pas de end_time", () => {
    expect(
      availabilityMatchesSlot(
        { date: "2026-06-22", start_time: "12:05" },
        slot,
      ),
    ).toBe(true);
    expect(
      availabilityMatchesSlot(
        { date: "2026-06-22", start_time: "12:00" },
        slot,
      ),
    ).toBe(false);
  });

  it("gère les timestamps ISO (substring date/heure)", () => {
    const av = {
      date: "2026-06-22T00:00:00.000Z",
      start_time: "12:00:00",
      end_time: "13:00:00",
    };
    expect(availabilityMatchesSlot(av, slot)).toBe(true);
  });
});

describe("isFrozen", () => {
  const now = new Date("2026-06-22T08:00:00");
  it("gèle un créneau à moins de 24h", () => {
    const slot = { date: "2026-06-22", start_time: "18:00", end_time: "18:20" };
    expect(isFrozen(slot, now)).toBe(true);
  });
  it("ne gèle pas un créneau à plus de 24h", () => {
    const slot = { date: "2026-06-24", start_time: "10:00", end_time: "10:20" };
    expect(isFrozen(slot, now)).toBe(false);
  });
});

describe("scoreMember (équité + brassage)", () => {
  it("privilégie le membre le moins chargé", () => {
    const load = { a: 0, b: 2 };
    const pairs = new Map<string, number>();
    expect(scoreMember("a", [], load, pairs)).toBeLessThan(
      scoreMember("b", [], load, pairs),
    );
  });

  it("pénalise un binôme récurrent (brassage)", () => {
    const load = { a: 1, b: 1, c: 1 };
    const pairs = new Map<string, number>([[pairKey("a", "x"), 3]]);
    // a déjà beaucoup tourné avec x → score plus élevé que c (jamais avec x)
    expect(scoreMember("a", ["x"], load, pairs)).toBeGreaterThan(
      scoreMember("c", ["x"], load, pairs),
    );
  });
});

describe("availabilityMatchesSlot — épreuves simultanées", () => {
  // Deux épreuves différentes, EXACTEMENT le même horaire : cocher l'une rend
  // disponible pour l'autre — c'est au dispatch de trancher.
  it("horaires identiques : la dispo vaut pour l'autre épreuve", () => {
    const av = {
      date: "2026-06-22",
      start_time: "14:00",
      end_time: "15:00",
      epreuve_id: "epreuve-A",
    };
    const slotB = {
      date: "2026-06-22",
      start_time: "14:00",
      end_time: "15:00",
      epreuve_id: "epreuve-B",
    };
    expect(availabilityMatchesSlot(av, slotB)).toBe(true);
  });

  // Horaires seulement partiellement superposés : l'épreuve compte.
  it("chevauchement partiel : ne matche PAS une autre épreuve", () => {
    const av = {
      date: "2026-06-22",
      start_time: "14:00",
      end_time: "15:00",
      epreuve_id: "epreuve-A",
    };
    const slotB = {
      date: "2026-06-22",
      start_time: "14:30",
      end_time: "15:30",
      epreuve_id: "epreuve-B",
    };
    expect(availabilityMatchesSlot(av, slotB)).toBe(false);
  });

  it("chevauchement partiel : matche la MÊME épreuve", () => {
    const av = {
      date: "2026-06-22",
      start_time: "14:00",
      end_time: "15:00",
      epreuve_id: "epreuve-A",
    };
    const slotA2 = {
      date: "2026-06-22",
      start_time: "14:30",
      end_time: "15:30",
      epreuve_id: "epreuve-A",
    };
    expect(availabilityMatchesSlot(av, slotA2)).toBe(true);
  });

  it("dispo héritée (sans épreuve) : comportement historique préservé", () => {
    const av = { date: "2026-06-22", start_time: "14:00", end_time: "15:00" };
    const slotB = {
      date: "2026-06-22",
      start_time: "14:30",
      end_time: "15:30",
      epreuve_id: "epreuve-B",
    };
    expect(availabilityMatchesSlot(av, slotB)).toBe(true);
  });
});

describe("compareByTension (arbitrage entre créneaux simultanés)", () => {
  const base = { date: "2026-06-22", start_time: "14:00" };

  it("sert d'abord le créneau qui manque d'examinateurs", () => {
    const tendu = { ...base, id: "tendu", eligible: 2, quota: 2 };
    const confortable = { ...base, id: "conf", eligible: 8, quota: 2 };
    expect(compareByTension(tendu, confortable)).toBeLessThan(0);
  });

  it("à tension égale, départage sur le nombre d'examinateurs disponibles", () => {
    const a = { ...base, id: "a", eligible: 3, quota: 2 };
    const b = { ...base, id: "b", eligible: 4, quota: 3 };
    expect(compareByTension(a, b)).toBeLessThan(0);
  });

  it("à égalité complète, ordre chronologique (déterminisme)", () => {
    const matin = { date: "2026-06-22", start_time: "09:00", id: "m", eligible: 4, quota: 2 };
    const aprem = { date: "2026-06-22", start_time: "16:00", id: "a", eligible: 4, quota: 2 };
    expect(compareByTension(matin, aprem)).toBeLessThan(0);
  });

  it("trie une liste : le plus en tension d'abord", () => {
    const slots = [
      { ...base, id: "large", eligible: 10, quota: 2 },
      { ...base, id: "juste", eligible: 2, quota: 2 },
      { ...base, id: "moyen", eligible: 5, quota: 2 },
    ];
    expect([...slots].sort(compareByTension).map((s) => s.id)).toEqual([
      "juste",
      "moyen",
      "large",
    ]);
  });
});

describe("slotTension", () => {
  it("est négative quand il manque des examinateurs", () => {
    expect(slotTension(1, 2)).toBe(-1);
  });
});

describe("epreuveShortfall (prévision : peut-on faire passer tout le monde ?)", () => {
  it("compte les candidats laissés sur le carreau", () => {
    // 60 candidats à faire passer, 40 places réellement dotables → 20 restent.
    expect(epreuveShortfall(60, 40).deficit).toBe(20);
  });

  it("ne compte pas de déficit quand la capacité suffit", () => {
    expect(epreuveShortfall(60, 90).deficit).toBe(0);
    expect(epreuveShortfall(60, 90).coverage).toBeCloseTo(1.5);
  });

  it("sans candidat à faire passer, la couverture est infinie (servie en dernier)", () => {
    expect(epreuveShortfall(0, 30).coverage).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("compareByTension — arbitrage entre épreuves simultanées", () => {
  // Le cas métier : Anna est libre lundi 9h. Il y a un entretien individuel
  // (9h–10h) et un business game (9h30–10h30). Les entretiens individuels ont
  // déjà de quoi faire passer tout le monde ; le business game, non.
  // → l'algorithme doit servir le business game en premier.
  const entretien = {
    id: "entretien-9h",
    date: "2026-06-22",
    start_time: "09:00",
    eligible: 4,
    quota: 2,
    ...epreuveShortfall(60, 90), // 90 places dotables pour 60 candidats
  };
  const businessGame = {
    id: "bg-9h30",
    date: "2026-06-22",
    start_time: "09:30",
    eligible: 4,
    quota: 2,
    ...epreuveShortfall(60, 40), // seulement 40 places dotables
  };

  const withShortfall = (s: any) => ({
    ...s,
    epreuveDeficit: s.deficit,
    epreuveCoverage: s.coverage,
  });

  it("privilégie l'épreuve qui laisserait des candidats sans passage", () => {
    expect(
      compareByTension(withShortfall(businessGame), withShortfall(entretien)),
    ).toBeLessThan(0);
  });

  it("le déficit prime sur la tension du créneau", () => {
    // L'entretien individuel est pourtant plus tendu en examinateurs (2 dispos
    // pour 2 requis) — le business game passe quand même devant.
    const entretienTendu = withShortfall({ ...entretien, eligible: 2 });
    const bgConfortable = withShortfall({ ...businessGame, eligible: 9 });
    expect(compareByTension(bgConfortable, entretienTendu)).toBeLessThan(0);
  });

  it("à déficit nul des deux côtés, la couverture la plus faible passe devant", () => {
    const juste = withShortfall({ ...entretien, ...epreuveShortfall(60, 62) });
    const large = withShortfall({ ...entretien, ...epreuveShortfall(60, 200) });
    expect(compareByTension(juste, large)).toBeLessThan(0);
  });

  it("sans prévision disponible, retombe sur la tension par créneau", () => {
    const tendu = { id: "a", date: "2026-06-22", start_time: "09:00", eligible: 2, quota: 2 };
    const large = { id: "b", date: "2026-06-22", start_time: "09:00", eligible: 9, quota: 2 };
    expect(compareByTension(tendu, large)).toBeLessThan(0);
  });
});

// ─── Continuité de salle ──────────────────────────────────────────────
// Cf. docs/superpowers/specs/2026-09-08-dispatch-continuite-salle-design.md
// Un examinateur reste dans la même salle avec le même binôme jusqu'à
// ROOM_STREAK_MAX créneaux consécutifs, puis tourne.

describe("roomStreak (ancienneté d'un membre dans une salle)", () => {
  // Une salle, 4 créneaux qui se suivent le même jour.
  const chain = ["s1", "s2", "s3", "s4"];

  it("vaut 0 sur le premier créneau de la salle", () => {
    const members = new Map<string, Set<string>>();
    expect(roomStreak("alice", chain, 0, members)).toBe(0);
  });

  it("compte les créneaux consécutifs précédents", () => {
    const members = new Map([
      ["s1", new Set(["alice", "bob"])],
      ["s2", new Set(["alice", "bob"])],
    ]);
    // Alice arrive sur s3 après s1 et s2 → streak de 2.
    expect(roomStreak("alice", chain, 2, members)).toBe(2);
  });

  it("s'arrête à la première interruption (le membre avait quitté la salle)", () => {
    const members = new Map([
      ["s1", new Set(["alice"])],
      ["s2", new Set(["claire"])], // alice absente : la chaîne est rompue
      ["s3", new Set(["alice"])],
    ]);
    expect(roomStreak("alice", chain, 3, members)).toBe(1);
  });

  it("ne compte pas un membre jamais passé dans la salle", () => {
    const members = new Map([
      ["s1", new Set(["bob"])],
      ["s2", new Set(["bob"])],
    ]);
    expect(roomStreak("alice", chain, 2, members)).toBe(0);
  });

  it("plafonne à ROOM_STREAK_MAX (parcours borné)", () => {
    const longChain = ["a", "b", "c", "d", "e", "f", "g"];
    const members = new Map(
      longChain.map((id) => [id, new Set(["alice"])] as const),
    );
    expect(roomStreak("alice", longChain, 6, members)).toBe(ROOM_STREAK_MAX);
  });
});

describe("scoreMember — bonus de continuité", () => {
  it("garde sur place un membre qui continue sa chaîne, même plus chargé", () => {
    // Alice est dans la salle depuis 2 créneaux (donc plus chargée) ;
    // Claire n'a rien fait. Sans continuité, Claire gagnerait.
    const load = { alice: 2, claire: 0 };
    const pairs = new Map<string, number>();
    const continuity = { continuing: new Set(["alice"]) };

    expect(scoreMember("alice", [], load, pairs, continuity)).toBeLessThan(
      scoreMember("claire", [], load, pairs, continuity),
    );
  });

  it("lâche le membre une fois son streak épuisé (rotation au 4ème créneau)", () => {
    // Même situation, mais Alice a atteint le plafond : elle n'est plus dans
    // `continuing` → la charge reprend la main et Claire passe devant.
    const load = { alice: 3, claire: 0 };
    const pairs = new Map<string, number>();
    const continuity = { continuing: new Set<string>() };

    expect(scoreMember("claire", [], load, pairs, continuity)).toBeLessThan(
      scoreMember("alice", [], load, pairs, continuity),
    );
  });

  it("garde Alice sur place quand son binôme Bob n'est plus disponible", () => {
    // Bob a sauté ; le pool est Alice (sur place) et Claire (fraîche).
    // Alice doit rester dans sa salle, Claire la rejoint.
    const load = { alice: 1, claire: 0 };
    const pairs = new Map<string, number>();
    const continuity = { continuing: new Set(["alice"]) };

    const pool = ["claire", "alice"].sort(
      (a, b) =>
        scoreMember(a, [], load, pairs, continuity) -
        scoreMember(b, [], load, pairs, continuity),
    );
    expect(pool[0]).toBe("alice");
  });

  it("l'ancrage inter-run départage à égalité stricte", () => {
    const load = { alice: 1, claire: 1 };
    const pairs = new Map<string, number>();
    const continuity = { anchored: new Set(["claire"]) };

    expect(scoreMember("claire", [], load, pairs, continuity)).toBeLessThan(
      scoreMember("alice", [], load, pairs, continuity),
    );
  });

  it("l'ancrage inter-run ne renverse jamais un écart de charge", () => {
    // Claire est ancrée mais a un créneau de plus qu'Alice : l'équité prime.
    const load = { alice: 0, claire: 1 };
    const pairs = new Map<string, number>();
    const continuity = { anchored: new Set(["claire"]) };

    expect(scoreMember("alice", [], load, pairs, continuity)).toBeLessThan(
      scoreMember("claire", [], load, pairs, continuity),
    );
  });

  it("sans info de continuité, le score est inchangé (rétro-compatibilité)", () => {
    const load = { alice: 2, claire: 0 };
    const pairs = new Map<string, number>();
    expect(scoreMember("alice", [], load, pairs)).toBe(
      scoreMember("alice", [], load, pairs, {}),
    );
  });
});

describe("orderPredecessorsFirst (un créneau après son prédécesseur de salle)", () => {
  it("remonte le prédécesseur avant son successeur", () => {
    // Ordre de tension : s2 (14h) avant s1 (13h), alors que s1 le précède
    // dans la salle. s1 doit être décidé en premier pour servir d'ancre.
    const slots = [{ id: "s2" }, { id: "s1" }];
    const predecessor = new Map([["s2", "s1"]]);
    expect(orderPredecessorsFirst(slots, predecessor).map((s) => s.id)).toEqual([
      "s1",
      "s2",
    ]);
  });

  it("préserve l'ordre de tension entre créneaux sans lien de chaîne", () => {
    const slots = [{ id: "b" }, { id: "a" }, { id: "c" }];
    expect(
      orderPredecessorsFirst(slots, new Map()).map((s) => s.id),
    ).toEqual(["b", "a", "c"]);
  });

  it("déroule une chaîne complète dans l'ordre", () => {
    const slots = [{ id: "s3" }, { id: "s1" }, { id: "s2" }];
    const predecessor = new Map([
      ["s3", "s2"],
      ["s2", "s1"],
    ]);
    expect(orderPredecessorsFirst(slots, predecessor).map((s) => s.id)).toEqual([
      "s1",
      "s2",
      "s3",
    ]);
  });

  it("ignore un prédécesseur absent du lot (gelé ou hors périmètre)", () => {
    const slots = [{ id: "s2" }];
    const predecessor = new Map([["s2", "s1-gelé"]]);
    expect(orderPredecessorsFirst(slots, predecessor).map((s) => s.id)).toEqual([
      "s2",
    ]);
  });

  it("n'émet chaque créneau qu'une fois", () => {
    const slots = [{ id: "s3" }, { id: "s2" }, { id: "s1" }];
    const predecessor = new Map([
      ["s3", "s2"],
      ["s2", "s1"],
    ]);
    expect(orderPredecessorsFirst(slots, predecessor)).toHaveLength(3);
  });
});
