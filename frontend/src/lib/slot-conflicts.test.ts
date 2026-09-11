import { describe, it, expect } from "vitest";
import {
  timeToMinutes,
  minutesToTime,
  normalizeRoom,
  findConflict,
  addInterval,
  type RoomInterval,
} from "./slot-conflicts";

/**
 * Ces fonctions sont le garde-fou anti-chevauchement de TOUTE la chaîne de
 * création de créneaux (ouvertures, bulk-create, publish, déplacement).
 *
 * Elles n'avaient aucun test — alors qu'un bug y est déjà passé inaperçu le
 * 10/09/2026 : `fetchDayIntervals` renvoyait toujours une Map vide, donc plus
 * aucune route ne détectait le moindre chevauchement de salle.
 */

describe("timeToMinutes", () => {
  it("convertit une heure HH:MM", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("08:30")).toBe(510);
    expect(timeToMinutes("23:59")).toBe(1439);
  });

  it("tolère le format HH:MM:SS de Postgres", () => {
    expect(timeToMinutes("08:30:00")).toBe(510);
  });

  it("ne casse pas sur une valeur vide", () => {
    expect(timeToMinutes("")).toBe(0);
  });
});

describe("minutesToTime", () => {
  it("reformate en HH:MM zéro-paddé", () => {
    expect(minutesToTime(0)).toBe("00:00");
    expect(minutesToTime(510)).toBe("08:30");
    expect(minutesToTime(1439)).toBe("23:59");
  });

  it("fait l'aller-retour avec timeToMinutes", () => {
    for (const t of ["07:05", "12:00", "19:45"]) {
      expect(minutesToTime(timeToMinutes(t))).toBe(t);
    }
  });
});

describe("normalizeRoom", () => {
  it("ignore la casse et les espaces de bord", () => {
    expect(normalizeRoom("  Salle 1 ")).toBe(normalizeRoom("salle 1"));
  });

  it("réduit les espaces multiples", () => {
    expect(normalizeRoom("Salle   1")).toBe("salle 1");
  });

  it("renvoie une chaîne vide pour null/undefined", () => {
    expect(normalizeRoom(null)).toBe("");
    expect(normalizeRoom(undefined)).toBe("");
    expect(normalizeRoom("   ")).toBe("");
  });

  it("conserve les salles réelles du projet telles quelles", () => {
    expect(normalizeRoom("242-244")).toBe("242-244");
    expect(normalizeRoom("238-240")).toBe("238-240");
  });

  it("LIMITE CONNUE : l'espacement autour du tiret n'est PAS normalisé", () => {
    // « 242-244 » et « 242 - 244 » désignent la même salle physique mais ne se
    // rapprochent pas — deux orthographes ne se verraient donc pas mutuellement
    // lors du contrôle de chevauchement. Le champ salle étant une saisie libre,
    // c'est un piège à connaître.
    expect(normalizeRoom("242 - 244")).not.toBe(normalizeRoom("242-244"));
  });
});

describe("findConflict", () => {
  const intervals = (): Map<string, RoomInterval[]> =>
    new Map([
      [
        "205",
        [
          { startMin: 480, endMin: 505, room: "205", slotId: "a" }, // 08:00-08:25
          { startMin: 510, endMin: 535, room: "205", slotId: "b" }, // 08:30-08:55
        ],
      ],
    ]);

  it("détecte un chevauchement franc", () => {
    expect(findConflict(intervals(), "205", 490, 520)).not.toBeNull();
  });

  it("laisse passer un créneau adjacent (fin == début)", () => {
    // 08:25-08:30 s'intercale exactement entre les deux : aucun chevauchement.
    expect(findConflict(intervals(), "205", 505, 510)).toBeNull();
  });

  it("laisse passer un créneau totalement disjoint", () => {
    expect(findConflict(intervals(), "205", 600, 625)).toBeNull();
  });

  it("détecte un créneau qui en englobe un autre", () => {
    expect(findConflict(intervals(), "205", 470, 600)).not.toBeNull();
  });

  it("détecte un créneau strictement inclus dans un autre", () => {
    expect(findConflict(intervals(), "205", 485, 495)).not.toBeNull();
  });

  it("ne confond pas deux salles différentes", () => {
    expect(findConflict(intervals(), "217", 490, 520)).toBeNull();
  });

  it("compare les salles de façon normalisée", () => {
    const map = new Map([
      ["salle 1", [{ startMin: 480, endMin: 505, room: "Salle 1" }]],
    ]);
    expect(findConflict(map, "  SALLE 1 ", 490, 500)).not.toBeNull();
  });

  it("ignore le créneau en cours de modification (excludeSlotId)", () => {
    // Sans exclusion, déplacer « a » de 2 minutes se heurterait à lui-même.
    expect(findConflict(intervals(), "205", 482, 507)).not.toBeNull();
    expect(findConflict(intervals(), "205", 482, 507, "a")).toBeNull();
  });

  it("n'exclut que le créneau visé, pas ses voisins", () => {
    expect(findConflict(intervals(), "205", 500, 520, "a")).not.toBeNull();
  });

  it("renvoie l'intervalle en conflit, pour pouvoir l'afficher", () => {
    const hit = findConflict(intervals(), "205", 490, 520);
    expect(hit?.room).toBe("205");
    expect(hit?.startMin).toBe(480);
    expect(hit?.endMin).toBe(505);
  });

  it("ne trouve rien dans une salle inconnue", () => {
    expect(findConflict(new Map(), "205", 480, 505)).toBeNull();
  });
});

describe("addInterval", () => {
  it("permet de détecter un conflit INTERNE à un même lot de création", () => {
    // C'est tout l'intérêt : bulk-create pose ses créneaux un par un et doit
    // voir ceux qu'il vient lui-même d'ajouter.
    const map = new Map<string, RoomInterval[]>();
    expect(findConflict(map, "205", 480, 505)).toBeNull();
    addInterval(map, "205", 480, 505);
    expect(findConflict(map, "205", 490, 520)).not.toBeNull();
  });

  it("crée la salle si elle n'existe pas encore", () => {
    const map = new Map<string, RoomInterval[]>();
    addInterval(map, "Salle 9", 480, 505);
    expect(map.get("salle 9")).toHaveLength(1);
  });

  it("indexe sous la forme normalisée", () => {
    const map = new Map<string, RoomInterval[]>();
    addInterval(map, "  SALLE 9 ", 480, 505);
    expect(findConflict(map, "salle 9", 490, 500)).not.toBeNull();
  });

  it("ignore une salle vide plutôt que de créer une clé parasite", () => {
    const map = new Map<string, RoomInterval[]>();
    addInterval(map, "   ", 480, 505);
    expect(map.size).toBe(0);
  });

  it("cumule plusieurs intervalles dans la même salle", () => {
    const map = new Map<string, RoomInterval[]>();
    addInterval(map, "205", 480, 505);
    addInterval(map, "205", 510, 535);
    expect(map.get("205")).toHaveLength(2);
  });
});
