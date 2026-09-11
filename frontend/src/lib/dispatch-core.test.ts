import { describe, it, expect } from "vitest";
import {
  pairKey,
  timeOverlaps,
  availabilityMatchesSlot,
  isFrozen,
  scoreMember,
  compareByTension,
  slotTension,
  slotFillTarget,
  epreuveShortfall,
  roomStreak,
  orderPredecessorsFirst,
  blocksSlot,
  ROOM_STREAK_MAX,
  ROOM_CONTINUITY_BONUS,
  availabilitiesCoverSlot,
  UPROOT_PENALTY,
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

describe("blocksSlot", () => {
  const day = "2026-09-16";

  it("bloque un chevauchement strict, même salle", () => {
    const c = { date: day, start: "18:00", end: "19:00", room: "235", roulementMinutes: 10 };
    const slot = { date: day, start: "18:30", end: "19:30", room: "235", roulementMinutes: 10 };
    expect(blocksSlot(c, slot)).toBe(true);
  });

  it("bloque un chevauchement strict, salles différentes", () => {
    const c = { date: day, start: "18:00", end: "19:00", room: "235", roulementMinutes: 10 };
    const slot = { date: day, start: "18:30", end: "19:30", room: "219", roulementMinutes: 10 };
    expect(blocksSlot(c, slot)).toBe(true);
  });

  it("n'autorise AUCUNE pause si c'est la même salle (continuité) — cas réel du 10/09/2026", () => {
    const c = { date: day, start: "16:00", end: "16:45", room: "235", roulementMinutes: 10 };
    const slot = { date: day, start: "16:45", end: "17:30", room: "235", roulementMinutes: 10 };
    expect(blocksSlot(c, slot)).toBe(false);
  });

  it("bloque un enchaînement à la minute près sur une AUTRE salle (bug remonté par Felix)", () => {
    const c = { date: day, start: "18:45", end: "19:30", room: "235", roulementMinutes: 10 };
    const slot = { date: day, start: "19:30", end: "19:55", room: "219", roulementMinutes: 10 };
    expect(blocksSlot(c, slot)).toBe(true);
  });

  it("laisse passer un changement de salle si le battement atteint le roulement requis", () => {
    const c = { date: day, start: "18:45", end: "19:30", room: "235", roulementMinutes: 10 };
    const slot = { date: day, start: "19:40", end: "20:05", room: "219", roulementMinutes: 10 };
    expect(blocksSlot(c, slot)).toBe(false);
  });

  it("prend le roulement le PLUS EXIGEANT des deux créneaux", () => {
    const c = { date: day, start: "18:00", end: "18:45", room: "235", roulementMinutes: 10 };
    const slot = { date: day, start: "19:00", end: "19:30", room: "219", roulementMinutes: 20 };
    // battement de 15min < roulement requis (max(10,20)=20) → bloqué
    expect(blocksSlot(c, slot)).toBe(true);
  });

  it("ne bloque jamais sur un autre jour", () => {
    const c = { date: "2026-09-15", start: "18:45", end: "19:30", room: "235", roulementMinutes: 10 };
    const slot = { date: day, start: "19:30", end: "19:55", room: "219", roulementMinutes: 10 };
    expect(blocksSlot(c, slot)).toBe(false);
  });

  it("ne bloque pas sur une contrainte de pause si une salle est inconnue", () => {
    const c = { date: day, start: "18:45", end: "19:30", room: null, roulementMinutes: 10 };
    const slot = { date: day, start: "19:30", end: "19:55", room: "219", roulementMinutes: 10 };
    expect(blocksSlot(c, slot)).toBe(false);
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

// ─── Priorité groupe (spec du 09/09/2026) ──────────────────────────────
// Cas réel qui a motivé le correctif : 9 examinateurs disponibles à 18h10 le
// 15 septembre, 3 salles business game ouvertes à cette heure, 0 examinateur
// affecté sur 2 d'entre elles — les mêmes personnes tournaient sur des
// entretiens individuels au même horaire. `staffableCapacity` compte la
// capacité de chaque créneau de groupe indépendamment puis les additionne :
// avec plusieurs salles simultanées, la capacité calculée de l'épreuve
// ressort gonflée et son déficit artificiellement bas. Le critère de TYPE
// (ajouté en tier 0) sert de filet de secours qui ne dépend pas de ce calcul.
describe("compareByTension — priorité de type (groupe avant individuel)", () => {
  it("un créneau de groupe passe avant un individuel, même déficit affiché", () => {
    const groupe = { id: "bg", date: "2026-09-15", start_time: "18:10", eligible: 9, quota: 4, isGroupEpreuve: true };
    const individuel = { id: "ei", date: "2026-09-15", start_time: "18:00", eligible: 9, quota: 2, isGroupEpreuve: false };
    expect(compareByTension(groupe, individuel)).toBeLessThan(0);
    expect(compareByTension(individuel, groupe)).toBeGreaterThan(0);
  });

  it("passe MÊME QUAND le déficit calculé favoriserait l'individuel — c'est précisément le bug réel", () => {
    // Capacité de l'épreuve de groupe sur-comptée (plusieurs salles
    // simultanées comptées comme indépendantes) → déficit calculé à 0,
    // alors qu'en réalité une seule salle peut être staffée avec 9 personnes
    // partagées entre 3 salles de 4. L'individuel, lui, affiche un vrai
    // déficit. Sans le tier de type, l'individuel gagnerait à tort.
    const groupeSurCompte = {
      id: "bg", date: "2026-09-15", start_time: "18:10", eligible: 9, quota: 4,
      isGroupEpreuve: true, epreuveDeficit: 0, epreuveCoverage: 3,
    };
    const individuelTendu = {
      id: "ei", date: "2026-09-15", start_time: "18:00", eligible: 9, quota: 2,
      isGroupEpreuve: false, epreuveDeficit: 12, epreuveCoverage: 0.4,
    };
    expect(compareByTension(groupeSurCompte, individuelTendu)).toBeLessThan(0);
  });

  it("entre deux créneaux de MÊME type, le déficit tranche normalement (tier de type neutre)", () => {
    const groupeTendu = { id: "a", date: "2026-06-22", start_time: "09:00", eligible: 4, quota: 4, isGroupEpreuve: true, epreuveDeficit: 20, epreuveCoverage: 0.3 };
    const groupeConfortable = { id: "b", date: "2026-06-22", start_time: "09:00", eligible: 4, quota: 4, isGroupEpreuve: true, epreuveDeficit: 0, epreuveCoverage: 2 };
    expect(compareByTension(groupeTendu, groupeConfortable)).toBeLessThan(0);
  });

  it("isGroupEpreuve absent des deux côtés (anciennes données) : comportement inchangé", () => {
    const a = { id: "a", date: "2026-06-22", start_time: "09:00", eligible: 4, quota: 2 };
    const b = { id: "b", date: "2026-06-22", start_time: "09:00", eligible: 9, quota: 2 };
    expect(compareByTension(a, b)).toBeLessThan(0); // retombe sur slotTension, comme avant
  });
});

describe("slotFillTarget (effectif cible du jury)", () => {
  it("épreuve individuelle : cible toujours le minimum, quel que soit group_size", () => {
    expect(slotFillTarget(2, false, 6)).toBe(2);
    expect(slotFillTarget(2, false, null)).toBe(2);
  });

  it("épreuve de groupe : cible le plafond group_size", () => {
    expect(slotFillTarget(4, true, 6)).toBe(6);
  });

  it("cas réel : 9 dispo, minimum 4, group_size 6 → cible 6 (la boucle s'arrêtera à 6, pas 9)", () => {
    expect(slotFillTarget(4, true, 6)).toBe(6);
  });

  it("group_size absent ou inférieur au minimum : replié sur le minimum, jamais en dessous", () => {
    expect(slotFillTarget(4, true, null)).toBe(4);
    expect(slotFillTarget(4, true, undefined)).toBe(4);
    expect(slotFillTarget(4, true, 2)).toBe(4); // group_size incohérent (< minimum) : le minimum prime
  });

  it("group_size au-dessus du minimum : la cible suit group_size", () => {
    expect(slotFillTarget(4, true, 5)).toBe(5);
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

describe("scoreMember — malus d'arrachement (piste 2)", () => {
  const load = { alice: 0, bob: 5 };
  const pairs = new Map<string, number>();

  it("pénalise un membre qu'on arracherait à une chaîne en cours ailleurs", () => {
    // Alice est au milieu d'une chaîne en salle 217. Ce créneau-ci est en 205.
    // Même si Alice est la moins chargée, Bob doit passer devant.
    const continuity = { uprooting: new Set(["alice"]) };
    expect(scoreMember("alice", [], load, pairs, continuity)).toBeGreaterThan(
      scoreMember("bob", [], load, pairs, continuity),
    );
  });

  it("n'arrache personne quand le membre continue SA propre chaîne ici", () => {
    // Sur le créneau de sa propre salle, Alice reçoit le bonus, pas le malus.
    const continuity = { continuing: new Set(["alice"]) };
    expect(scoreMember("alice", [], load, pairs, continuity)).toBeLessThan(
      scoreMember("bob", [], load, pairs, continuity),
    );
  });

  it("le malus est du même ordre que le bonus (symétrie rester / être arraché)", () => {
    expect(UPROOT_PENALTY).toBe(ROOM_CONTINUITY_BONUS);
  });

  it("sans information d'arrachement, le score est inchangé", () => {
    expect(scoreMember("alice", [], load, pairs, {})).toBe(
      scoreMember("alice", [], load, pairs),
    );
  });
});

describe("compareByTension — créneaux avec candidats inscrits", () => {
  const base = {
    date: "2026-09-21",
    start_time: "08:30",
    eligible: 4,
    quota: 2,
  };

  it("un créneau avec des candidats inscrits se sert en premier", () => {
    const avecCandidats = { ...base, id: "a", hasEnrolledCandidates: true };
    const sansCandidats = { ...base, id: "b", hasEnrolledCandidates: false };
    expect(compareByTension(avecCandidats, sansCandidats)).toBeLessThan(0);
    expect(compareByTension(sansCandidats, avecCandidats)).toBeGreaterThan(0);
  });

  it("passe MÊME devant un créneau de groupe sans inscrit — un rendez-vous pris prime", () => {
    const entretienAvecCandidat = {
      ...base,
      id: "entretien",
      hasEnrolledCandidates: true,
      isGroupEpreuve: false,
    };
    const groupeSansCandidat = {
      ...base,
      id: "bg",
      hasEnrolledCandidates: false,
      isGroupEpreuve: true,
    };
    expect(
      compareByTension(entretienAvecCandidat, groupeSansCandidat),
    ).toBeLessThan(0);
  });

  it("à inscrits égaux des deux côtés, l'arbitrage groupe/individuel reprend la main", () => {
    const individuel = { ...base, id: "a", hasEnrolledCandidates: true };
    const groupe = {
      ...base,
      id: "b",
      hasEnrolledCandidates: true,
      isGroupEpreuve: true,
    };
    expect(compareByTension(groupe, individuel)).toBeLessThan(0);
  });

  it("champ absent des deux côtés (anciennes données) : comportement inchangé", () => {
    const a = { ...base, id: "a", isGroupEpreuve: true };
    const b = { ...base, id: "b", isGroupEpreuve: false };
    expect(compareByTension(a, b)).toBeLessThan(0);
  });
});

describe("compareByTension — départage par continuité de salle (piste 1)", () => {
  // Cas réel du lundi 21/09/2026 : salle 217 et salle 205 proposent le même
  // entretien individuel à 08:30. Amandine et Esther viennent de terminer en
  // 217. Avant ce départage, l'ordre tombait sur la comparaison d'UUID : la
  // 205 pouvait être servie en premier, capter le duo, et laisser la 217 vide.
  const salle217 = {
    id: "zzz-217-0830", // UUID défavorable exprès
    date: "2026-09-21",
    start_time: "08:30",
    eligible: 2,
    quota: 2,
    continuesChain: true, // le duo est déjà en 217 au créneau précédent
  };
  const salle205 = {
    id: "aaa-205-0830",
    date: "2026-09-21",
    start_time: "08:30",
    eligible: 2,
    quota: 2,
    continuesChain: false, // la 205 démarre à froid
  };

  it("le créneau qui prolonge une salle occupée se sert avant celui qui démarre à froid", () => {
    expect(compareByTension(salle217, salle205)).toBeLessThan(0);
    expect(compareByTension(salle205, salle217)).toBeGreaterThan(0);
  });

  it("ne s'applique qu'à égalité stricte — la tension reste prioritaire", () => {
    const froidMaisTendu = { ...salle205, eligible: 1 };
    expect(compareByTension(froidMaisTendu, salle217)).toBeLessThan(0);
  });

  it("ne perturbe pas l'ordre chronologique entre créneaux d'horaires différents", () => {
    const tot = { ...salle205, start_time: "08:00" };
    const tard = { ...salle217, start_time: "09:00" };
    expect(compareByTension(tot, tard)).toBeLessThan(0);
  });

  it("champ absent des deux côtés : départage déterministe par id, comme avant", () => {
    const a = { ...salle205, continuesChain: undefined };
    const b = { ...salle217, continuesChain: undefined };
    expect(compareByTension(a, b)).toBeLessThan(0); // "aaa…" < "zzz…"
  });
});

describe("availabilitiesCoverSlot — la dispo doit COUVRIR tout le créneau", () => {
  const slot = {
    date: "2026-09-21",
    start_time: "10:00",
    end_time: "10:25",
    epreuve_id: "ep1",
  };

  it("accepte une dispo qui englobe le créneau", () => {
    expect(
      availabilitiesCoverSlot(
        [{ date: "2026-09-21", start_time: "09:00", end_time: "12:00" }],
        slot,
      ),
    ).toBe(true);
  });

  it("REFUSE une dispo qui commence APRÈS le début du créneau — cas réel d'Amandine le 21/09", () => {
    // Dispo déclarée 10:15, créneau 10:00-10:25 : elle arriverait 15 min après
    // le début. L'ancien test (simple chevauchement) l'acceptait.
    expect(
      availabilitiesCoverSlot(
        [{ date: "2026-09-21", start_time: "10:15", end_time: "12:00" }],
        slot,
      ),
    ).toBe(false);
  });

  it("REFUSE une dispo qui se termine AVANT la fin du créneau", () => {
    expect(
      availabilitiesCoverSlot(
        [{ date: "2026-09-21", start_time: "09:00", end_time: "10:10" }],
        slot,
      ),
    ).toBe(false);
  });

  it("accepte quand la dispo colle exactement au créneau", () => {
    expect(
      availabilitiesCoverSlot(
        [{ date: "2026-09-21", start_time: "10:00", end_time: "10:25" }],
        slot,
      ),
    ).toBe(true);
  });

  it("FUSIONNE deux plages contiguës pour couvrir un créneau à cheval", () => {
    // Saisir 09:00-10:10 puis 10:10-11:00 revient à être dispo 09:00-11:00.
    expect(
      availabilitiesCoverSlot(
        [
          { date: "2026-09-21", start_time: "09:00", end_time: "10:10" },
          { date: "2026-09-21", start_time: "10:10", end_time: "11:00" },
        ],
        slot,
      ),
    ).toBe(true);
  });

  it("ne fusionne PAS deux plages séparées par un trou", () => {
    expect(
      availabilitiesCoverSlot(
        [
          { date: "2026-09-21", start_time: "09:00", end_time: "10:05" },
          { date: "2026-09-21", start_time: "10:15", end_time: "11:00" },
        ],
        slot,
      ),
    ).toBe(false);
  });

  it("ignore un autre jour", () => {
    expect(
      availabilitiesCoverSlot(
        [{ date: "2026-09-22", start_time: "09:00", end_time: "12:00" }],
        slot,
      ),
    ).toBe(false);
  });

  it("horaires strictement identiques : l'épreuve n'entre pas en ligne de compte", () => {
    expect(
      availabilitiesCoverSlot(
        [
          {
            date: "2026-09-21",
            start_time: "10:00",
            end_time: "10:25",
            epreuve_id: "AUTRE",
          },
        ],
        slot,
      ),
    ).toBe(true);
  });

  it("une dispo cochée sur une AUTRE épreuve ne compte pas si les horaires diffèrent", () => {
    expect(
      availabilitiesCoverSlot(
        [
          {
            date: "2026-09-21",
            start_time: "09:00",
            end_time: "12:00",
            epreuve_id: "AUTRE",
          },
        ],
        slot,
      ),
    ).toBe(false);
  });

  it("une dispo cochée sur LA BONNE épreuve compte", () => {
    expect(
      availabilitiesCoverSlot(
        [
          {
            date: "2026-09-21",
            start_time: "09:00",
            end_time: "12:00",
            epreuve_id: "ep1",
          },
        ],
        slot,
      ),
    ).toBe(true);
  });

  it("dispo héritée sans heure de fin : comportement historique conservé", () => {
    expect(
      availabilitiesCoverSlot(
        [{ date: "2026-09-21", start_time: "10:00" }],
        slot,
      ),
    ).toBe(true);
    expect(
      availabilitiesCoverSlot(
        [{ date: "2026-09-21", start_time: "09:00" }],
        slot,
      ),
    ).toBe(false);
  });

  it("liste vide : pas disponible", () => {
    expect(availabilitiesCoverSlot([], slot)).toBe(false);
  });

  it("cas Business Game : dispo 17:00-18:00 ne couvre pas un créneau 17:50-18:35", () => {
    expect(
      availabilitiesCoverSlot(
        [{ date: "2026-09-21", start_time: "17:00", end_time: "18:00" }],
        { date: "2026-09-21", start_time: "17:50", end_time: "18:35", epreuve_id: "bg" },
      ),
    ).toBe(false);
  });
});
