import { describe, it, expect } from "vitest";
import { generateTourOpenings, type TourEpreuveNeed } from "./tour-openings";
import { hhmmToMinutes, minutesToHHMM } from "./time-bands";

const win = (m: string, s: string, e: string) => ({
  memberId: m,
  startMin: hhmmToMinutes(s),
  endMin: hhmmToMinutes(e),
});

const groupe = (over: Partial<TourEpreuveNeed> = {}): TourEpreuveNeed => ({
  epreuveId: "business-game",
  isGroupEpreuve: true,
  evaluatorsPerRoom: 4,
  slotSpanMin: 55, // 45 min + 10 min de roulement
  targetSlots: 20,
  rooms: ["205", "217"],
  ...over,
});

const indiv = (over: Partial<TourEpreuveNeed> = {}): TourEpreuveNeed => ({
  epreuveId: "entretien",
  isGroupEpreuve: false,
  evaluatorsPerRoom: 2,
  slotSpanMin: 30, // 25 min + 5 min de roulement
  targetSlots: 50,
  rooms: ["235", "238-240", "242-244"],
  ...over,
});

const totalBands = (r: ReturnType<typeof generateTourOpenings>, epreuveId: string) =>
  r.bandsByEpreuve[epreuveId].reduce((s, b) => s + (b.endMin - b.startMin), 0);

describe("priorité collectif → individuel", () => {
  it("8 examinateurs : sert le collectif d'abord (2 salles), rien au reste s'il n'en a pas besoin", () => {
    const r = generateTourOpenings({
      days: [{ dayIndex: 0, windows: ["a", "b", "c", "d", "e", "f", "g", "h"].map((m) => win(m, "09:00", "12:00")) }],
      epreuves: [groupe({ targetSlots: 3 }), indiv({ targetSlots: 0 })],
    });
    expect(r.bandsByEpreuve["business-game"].length).toBeGreaterThan(0);
    expect(r.bandsByEpreuve["entretien"]).toEqual([]);
    expect(r.remainingByEpreuve["business-game"]).toBe(0);
  });

  it("8 examinateurs, collectif comblé après 1 salle : le reste sert l'individuel", () => {
    const r = generateTourOpenings({
      days: [{ dayIndex: 0, windows: ["a", "b", "c", "d", "e", "f", "g", "h"].map((m) => win(m, "09:00", "12:00")) }],
      // Le collectif n'a besoin que d'1 créneau (55 min) : consomme peu de tranches,
      // puis libère de la place pour l'individuel.
      epreuves: [groupe({ targetSlots: 1 }), indiv({ targetSlots: 2 })],
    });
    expect(r.remainingByEpreuve["business-game"]).toBe(0);
    expect(r.remainingByEpreuve["entretien"]).toBe(0);
    expect(r.bandsByEpreuve["entretien"].length).toBeGreaterThan(0);
  });

  it("3 examinateurs (sous le seuil collectif) : va direct à l'individuel", () => {
    const r = generateTourOpenings({
      days: [{ dayIndex: 0, windows: ["a", "b", "c"].map((m) => win(m, "09:00", "12:00")) }],
      epreuves: [groupe({ targetSlots: 5 }), indiv({ targetSlots: 5 })],
    });
    expect(r.bandsByEpreuve["business-game"]).toEqual([]);
    expect(r.bandsByEpreuve["entretien"].length).toBeGreaterThan(0);
  });

  it("1 examinateur : ni collectif ni individuel", () => {
    const r = generateTourOpenings({
      days: [{ dayIndex: 0, windows: [win("a", "09:00", "12:00")] }],
      epreuves: [groupe({ targetSlots: 5 }), indiv({ targetSlots: 5 })],
    });
    expect(r.bandsByEpreuve["business-game"]).toEqual([]);
    expect(r.bandsByEpreuve["entretien"]).toEqual([]);
  });
});

describe("salles disjointes (le cas réel corrigé)", () => {
  it("chaque épreuve n'ouvre QUE dans ses propres salles", () => {
    const r = generateTourOpenings({
      days: [{ dayIndex: 0, windows: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((m) => win(m, "09:00", "12:00")) }],
      epreuves: [groupe({ rooms: ["205", "217"], targetSlots: 10 }), indiv({ rooms: ["235", "242"], targetSlots: 10 })],
    });
    const roomsGroupe = new Set(r.bandsByEpreuve["business-game"].map((b) => b.laneId));
    const roomsIndiv = new Set(r.bandsByEpreuve["entretien"].map((b) => b.laneId));
    for (const room of Array.from(roomsGroupe)) expect(["205", "217"]).toContain(room);
    for (const room of Array.from(roomsIndiv)) expect(["235", "242"]).toContain(room);
    // Aucune salle en commun dans les résultats.
    for (const room of Array.from(roomsGroupe)) expect(roomsIndiv.has(room)).toBe(false);
  });
});

describe("garde-fou anti-collision (salles partagées entre épreuves)", () => {
  it("une même salle n'est jamais donnée à deux épreuves sur la même tranche", () => {
    const r = generateTourOpenings({
      days: [{ dayIndex: 0, windows: ["a", "b", "c", "d", "e", "f"].map((m) => win(m, "09:00", "12:00")) }],
      // "205" apparaît dans les deux listes : collision volontaire.
      epreuves: [groupe({ rooms: ["205"], targetSlots: 10 }), indiv({ rooms: ["205", "217"], targetSlots: 10 })],
    });
    // Pour chaque (jour, tranche) où le groupe tient 205, l'individuel ne
    // doit pas AUSSI y avoir une bande qui chevauche.
    for (const gb of r.bandsByEpreuve["business-game"]) {
      if (gb.laneId !== "205") continue;
      for (const ib of r.bandsByEpreuve["entretien"]) {
        if (ib.laneId !== "205" || ib.dayIndex !== gb.dayIndex) continue;
        const overlap = gb.startMin < ib.endMin && ib.startMin < gb.endMin;
        expect(overlap).toBe(false);
      }
    }
  });
});

describe("reprise d'une salle après interruption par une épreuve prioritaire", () => {
  it("ne produit JAMAIS deux bandes qui se chevauchent dans la même salle", () => {
    // Effectif qui oscille : suffisant pour le collectif par intermittence,
    // sinon tout juste pour l'individuel. Les deux épreuves partagent LA
    // MÊME salle "205" (cas réel : listes de salles non disjointes) — le
    // collectif la reprend et la relâche plusieurs fois dans la journée.
    const windows = [];
    // 08:00-10:00 : seulement 2 (individuel)
    for (const t of ["08:00", "08:30", "09:00", "09:30"]) {
      const [h, m] = t.split(":").map(Number);
      windows.push(win("a", t, minutesToHHMM(h * 60 + m + 30)));
      windows.push(win("b", t, minutesToHHMM(h * 60 + m + 30)));
    }
    // 10:00-12:00 : 8 (collectif prend le dessus)
    for (const t of ["10:00", "10:30", "11:00", "11:30"]) {
      const [h, m] = t.split(":").map(Number);
      for (const id of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
        windows.push(win(id, t, minutesToHHMM(h * 60 + m + 30)));
      }
    }
    // 12:00-14:00 : retombe à 2 (individuel reprend 205)
    for (const t of ["12:00", "12:30", "13:00", "13:30"]) {
      const [h, m] = t.split(":").map(Number);
      windows.push(win("a", t, minutesToHHMM(h * 60 + m + 30)));
      windows.push(win("b", t, minutesToHHMM(h * 60 + m + 30)));
    }

    const r = generateTourOpenings({
      days: [{ dayIndex: 0, windows }],
      epreuves: [
        groupe({ rooms: ["205"], targetSlots: 99, evaluatorsPerRoom: 8 }),
        indiv({ rooms: ["205"], targetSlots: 99, evaluatorsPerRoom: 2 }),
      ],
    });

    const toutesLesBandes = [
      ...r.bandsByEpreuve["business-game"].map((b) => ({ ...b, ep: "groupe" })),
      ...r.bandsByEpreuve["entretien"].map((b) => ({ ...b, ep: "indiv" })),
    ];
    for (let i = 0; i < toutesLesBandes.length; i++) {
      for (let j = i + 1; j < toutesLesBandes.length; j++) {
        const a = toutesLesBandes[i];
        const b = toutesLesBandes[j];
        if (a.dayIndex !== b.dayIndex || a.laneId !== b.laneId) continue;
        const overlap = a.startMin < b.endMin && b.startMin < a.endMin;
        expect(overlap, `${a.ep} ${minutesToHHMM(a.startMin)}-${minutesToHHMM(a.endMin)} vs ${b.ep} ${minutesToHHMM(b.startMin)}-${minutesToHHMM(b.endMin)}`).toBe(false);
      }
    }
    // Les deux épreuves doivent malgré tout avoir pu produire des créneaux.
    expect(r.bandsByEpreuve["business-game"].length).toBeGreaterThan(0);
    expect(r.bandsByEpreuve["entretien"].length).toBeGreaterThan(0);
  });
});

describe("cible atteinte", () => {
  it("s'arrête de générer une fois la cible comblée pour les deux épreuves", () => {
    const manyDays = Array.from({ length: 5 }, (_, i) => ({
      dayIndex: i,
      windows: ["a", "b", "c", "d", "e", "f", "g", "h"].map((m) => win(m, "08:00", "20:30")),
    }));
    const r = generateTourOpenings({
      days: manyDays,
      epreuves: [groupe({ targetSlots: 4 }), indiv({ targetSlots: 4 })],
    });
    expect(r.remainingByEpreuve["business-game"]).toBe(0);
    expect(r.remainingByEpreuve["entretien"]).toBe(0);
    // Ne doit pas avoir consommé les 5 jours pour une demande aussi faible.
    const joursUtilises = new Set([
      ...r.bandsByEpreuve["business-game"].map((b) => b.dayIndex),
      ...r.bandsByEpreuve["entretien"].map((b) => b.dayIndex),
    ]);
    expect(joursUtilises.size).toBeLessThan(5);
  });

  it("rapporte ce qui manque encore quand l'effectif ne suffit pas", () => {
    const r = generateTourOpenings({
      days: [{ dayIndex: 0, windows: [win("a", "09:00", "10:00"), win("b", "09:00", "10:00")] }],
      epreuves: [groupe({ targetSlots: 20 }), indiv({ targetSlots: 20 })],
    });
    expect(r.remainingByEpreuve["business-game"]).toBeGreaterThan(0);
  });
});

describe("intégrité des bandes", () => {
  it("fusionne les tranches contiguës d'une même salle en une seule bande", () => {
    const r = generateTourOpenings({
      days: [{ dayIndex: 0, windows: ["a", "b"].map((m) => win(m, "09:00", "17:00")) }],
      epreuves: [indiv({ targetSlots: 99, rooms: ["235"] })],
    });
    const bands = r.bandsByEpreuve["entretien"];
    expect(bands.length).toBe(1);
    expect(minutesToHHMM(bands[0].startMin)).toBe("09:00");
  });

  it("aucune bande ne dépasse 08:00–20:30", () => {
    const r = generateTourOpenings({
      days: [{ dayIndex: 0, windows: ["a", "b"].map((m) => win(m, "07:00", "22:00")) }],
      epreuves: [indiv({ targetSlots: 99 })],
    });
    for (const b of r.bandsByEpreuve["entretien"]) {
      expect(b.startMin).toBeGreaterThanOrEqual(hhmmToMinutes("08:00"));
      expect(b.endMin).toBeLessThanOrEqual(hhmmToMinutes("20:30"));
    }
  });

  it("une épreuve sans salle déclarée ne produit aucune bande", () => {
    const r = generateTourOpenings({
      days: [{ dayIndex: 0, windows: ["a", "b"].map((m) => win(m, "09:00", "12:00")) }],
      epreuves: [indiv({ rooms: [], targetSlots: 10 })],
    });
    expect(r.bandsByEpreuve["entretien"]).toEqual([]);
  });
});
