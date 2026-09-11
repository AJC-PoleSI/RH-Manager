import { describe, it, expect } from "vitest";
import {
  validateOpeningInput,
  activeEnrollmentsOf,
  isSlotOccupied,
  isSlotStaffed,
  sliceParamsFromEpreuve,
  slotInsertRow,
  staleTimingCount,
  timingChangeWarning,
} from "./openings-service";

describe("validateOpeningInput", () => {
  const ok = {
    room: "205",
    date: "2026-09-21",
    start_time: "08:00",
    end_time: "12:00",
    break_start: null,
    break_end: null,
  };

  it("accepte une ouverture valide", () => {
    expect(validateOpeningInput(ok)).toBeNull();
  });

  it("accepte une ouverture avec pause", () => {
    expect(
      validateOpeningInput({ ...ok, break_start: "10:00", break_end: "10:30" }),
    ).toBeNull();
  });

  it("exige une salle", () => {
    expect(validateOpeningInput({ ...ok, room: "" })).toMatch(/salle/i);
    expect(validateOpeningInput({ ...ok, room: "   " })).toMatch(/salle/i);
  });

  it("exige une date au format AAAA-MM-JJ", () => {
    expect(validateOpeningInput({ ...ok, date: "" })).toMatch(/date/i);
    expect(validateOpeningInput({ ...ok, date: "21/09/2026" })).toMatch(/date/i);
    expect(validateOpeningInput({ ...ok, date: "2026-9-1" })).toMatch(/date/i);
  });

  it("exige des heures au format HH:MM", () => {
    expect(validateOpeningInput({ ...ok, start_time: "8:00" })).toMatch(/début/i);
    expect(validateOpeningInput({ ...ok, end_time: "12h00" })).toMatch(/fin/i);
  });

  it("refuse une plage inversée ou nulle", () => {
    expect(validateOpeningInput({ ...ok, start_time: "13:00" })).toMatch(
      /précéder/i,
    );
    expect(
      validateOpeningInput({ ...ok, start_time: "08:00", end_time: "08:00" }),
    ).toMatch(/précéder/i);
  });

  it("refuse une pause à moitié renseignée", () => {
    expect(validateOpeningInput({ ...ok, break_start: "10:00" })).toMatch(
      /début ET une fin/i,
    );
    expect(validateOpeningInput({ ...ok, break_end: "10:30" })).toMatch(
      /début ET une fin/i,
    );
  });

  it("refuse une pause inversée", () => {
    expect(
      validateOpeningInput({ ...ok, break_start: "11:00", break_end: "10:00" }),
    ).toMatch(/début de pause/i);
  });

  it("refuse une pause hors de la plage", () => {
    expect(
      validateOpeningInput({ ...ok, break_start: "07:00", break_end: "07:30" }),
    ).toMatch(/comprise dans la plage/i);
    expect(
      validateOpeningInput({ ...ok, break_start: "11:30", break_end: "13:00" }),
    ).toMatch(/comprise dans la plage/i);
  });

  it("refuse une pause mal formatée", () => {
    expect(
      validateOpeningInput({ ...ok, break_start: "10h", break_end: "10:30" }),
    ).toMatch(/pause invalides/i);
  });
});

describe("activeEnrollmentsOf", () => {
  const e = (status: string | null) => ({ candidate_id: "c1", status });

  it("compte une inscription active", () => {
    expect(activeEnrollmentsOf({ enrollments: [e("active")] })).toHaveLength(1);
  });

  it("compte une inscription sans statut (donnée ancienne)", () => {
    expect(activeEnrollmentsOf({ enrollments: [e(null)] })).toHaveLength(1);
  });

  it("compte une inscription au statut 'enrolled' — c'est le DÉFAUT du schéma", () => {
    // supabase-schema-tables.sql : `status TEXT DEFAULT 'enrolled'`.
    // Une ligne insérée sans statut explicite porte donc 'enrolled'. La
    // manquer ferait passer un créneau RÉSERVÉ pour libre : l'édition
    // d'ouverture pourrait le supprimer, et le candidat ne serait même pas
    // prévenu (cf. notifySlotDeletion).
    expect(activeEnrollmentsOf({ enrollments: [e("enrolled")] })).toHaveLength(1);
  });

  it("ignore une inscription annulée", () => {
    expect(activeEnrollmentsOf({ enrollments: [e("cancelled")] })).toHaveLength(
      0,
    );
  });

  it("ne casse pas sans inscriptions", () => {
    expect(activeEnrollmentsOf({})).toEqual([]);
    expect(activeEnrollmentsOf({ enrollments: [] })).toEqual([]);
  });
});

describe("isSlotOccupied", () => {
  it("occupé dès qu'un examinateur est affecté", () => {
    expect(isSlotOccupied({ members: [{ id: "m1" }], enrollments: [] })).toBe(
      true,
    );
  });

  it("occupé dès qu'un candidat est inscrit", () => {
    expect(
      isSlotOccupied({ members: [], enrollments: [{ status: "active" }] }),
    ).toBe(true);
  });

  it("occupé par une inscription au statut par défaut 'enrolled'", () => {
    expect(
      isSlotOccupied({ members: [], enrollments: [{ status: "enrolled" }] }),
    ).toBe(true);
  });

  it("libre quand l'inscription est annulée et qu'aucun examinateur n'est là", () => {
    expect(
      isSlotOccupied({ members: [], enrollments: [{ status: "cancelled" }] }),
    ).toBe(false);
  });

  it("libre quand tout est vide", () => {
    expect(isSlotOccupied({})).toBe(false);
  });
});

describe("isSlotStaffed", () => {
  it("vrai pour les statuts où le quota d'examinateurs est atteint", () => {
    for (const status of ["ready", "published", "full"]) {
      expect(isSlotStaffed({ status })).toBe(true);
    }
  });

  it("faux tant que le créneau n'est pas doté", () => {
    for (const status of ["draft", "open", "closed"]) {
      expect(isSlotStaffed({ status })).toBe(false);
    }
  });
});

describe("sliceParamsFromEpreuve", () => {
  it("lit la durée et le roulement de l'épreuve", () => {
    expect(
      sliceParamsFromEpreuve({ duration_minutes: 45, roulement_minutes: 10 }),
    ).toEqual({ durationMinutes: 45, roulementMinutes: 10 });
  });

  it("applique les valeurs par défaut", () => {
    expect(sliceParamsFromEpreuve({})).toEqual({
      durationMinutes: 30,
      roulementMinutes: 10,
    });
  });

  it("respecte un roulement explicitement nul (créneaux collés)", () => {
    expect(sliceParamsFromEpreuve({ roulement_minutes: 0 }).roulementMinutes).toBe(
      0,
    );
  });
});

describe("slotInsertRow", () => {
  const t = { startTime: "08:00", endTime: "08:25" };
  const individuelle = {
    id: "ep1",
    duration_minutes: 25,
    is_group_epreuve: false,
    min_evaluators_per_salle: 2,
    tour: 1,
  };
  const groupe = {
    id: "ep2",
    duration_minutes: 45,
    is_group_epreuve: true,
    group_size: 6,
    min_candidates: 4,
    min_evaluators_per_salle: 6,
    tour: 2,
  };

  it("épreuve individuelle : un seul candidat, pas de minimum de groupe", () => {
    const row = slotInsertRow(t, "2026-09-21", "205", individuelle, "op1");
    expect(row.max_candidates).toBe(1);
    expect(row.min_candidates).toBeNull();
    expect(row.min_members).toBe(2);
    expect(row.room).toBe("205");
    expect(row.epreuve_id).toBe("ep1");
    expect(row.opening_id).toBe("op1");
    expect(row.status).toBe("draft");
  });

  it("épreuve de groupe : capacité et minimum repris de l'épreuve", () => {
    const row = slotInsertRow(t, "2026-09-21", "235", groupe, "op2");
    expect(row.max_candidates).toBe(6);
    expect(row.min_candidates).toBe(4);
    expect(row.min_members).toBe(6);
    expect(row.tour).toBe(2);
  });

  it("min_members retombe sur 2 quand l'épreuve ne le précise pas", () => {
    const row = slotInsertRow(t, "2026-09-21", "205", { id: "x" }, "op3");
    expect(row.min_members).toBe(2);
  });

  it("date posée à midi pour ne jamais basculer de jour", () => {
    const row = slotInsertRow(t, "2026-09-21", "205", individuelle, "op1");
    // Midi local : même en UTC±13, on reste le 21.
    expect(row.date).toContain("2026-09-21");
  });

  it("conserve les horaires découpés tels quels", () => {
    const row = slotInsertRow(t, "2026-09-21", "205", individuelle, "op1");
    expect(row.start_time).toBe("08:00");
    expect(row.end_time).toBe("08:25");
  });
});

describe("staleTimingCount", () => {
  const s = (start: string, end: string) => ({ start_time: start, end_time: end });

  it("ne compte rien quand tous les créneaux font la bonne durée", () => {
    expect(staleTimingCount([s("08:00", "08:25"), s("08:35", "09:00")], 25)).toBe(0);
  });

  it("compte les créneaux dont la durée ne correspond plus", () => {
    // L'épreuve passe à 45 min : les créneaux de 25 min sont périmés.
    expect(staleTimingCount([s("08:00", "08:25"), s("08:35", "09:20")], 45)).toBe(1);
  });

  it("tolère le format HH:MM:SS de Postgres", () => {
    expect(staleTimingCount([s("08:00:00", "08:25:00")], 25)).toBe(0);
  });

  it("ne compte rien sur une liste vide", () => {
    expect(staleTimingCount([], 25)).toBe(0);
  });
});

describe("timingChangeWarning", () => {
  it("ne dit rien quand ni la durée ni le roulement ne changent", () => {
    expect(
      timingChangeWarning({
        durationChanged: false,
        roulementChanged: false,
        staleSlots: 0,
        totalSlots: 40,
      }),
    ).toBeNull();
  });

  it("ne dit rien quand l'épreuve n'a encore aucun créneau", () => {
    expect(
      timingChangeWarning({
        durationChanged: true,
        roulementChanged: false,
        staleSlots: 0,
        totalSlots: 0,
      }),
    ).toBeNull();
  });

  it("annonce combien de créneaux gardent l'ancienne durée", () => {
    const w = timingChangeWarning({
      durationChanged: true,
      roulementChanged: false,
      staleSlots: 12,
      totalSlots: 40,
    });
    expect(w).toContain("12");
    expect(w).toContain("40");
    expect(w).toMatch(/durée/i);
  });

  it("prévient aussi quand seul le roulement change", () => {
    const w = timingChangeWarning({
      durationChanged: false,
      roulementChanged: true,
      staleSlots: 0,
      totalSlots: 40,
    });
    expect(w).toMatch(/roulement/i);
  });

  it("dit explicitement que les créneaux existants ne sont PAS modifiés", () => {
    const w = timingChangeWarning({
      durationChanged: true,
      roulementChanged: true,
      staleSlots: 5,
      totalSlots: 10,
    });
    expect(w).toMatch(/inchang/i);
  });
});
