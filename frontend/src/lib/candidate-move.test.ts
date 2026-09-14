import { describe, it, expect } from "vitest";
import {
  planCandidateMove,
  describeSlot,
  type MoveEnrollment,
  type MoveSlotRef,
} from "./candidate-move";

const slot = (
  id: string,
  opts: Partial<MoveSlotRef> = {},
): MoveSlotRef => ({
  id,
  date: "2026-09-15",
  start_time: "08:30",
  end_time: "08:55",
  room: "205",
  epreuve_id: "ep1",
  ...opts,
});

const enr = (id: string, s: MoveSlotRef | null, status = "active"): MoveEnrollment => ({
  id,
  status: status as any,
  slot: s,
});

const cible = slot("target", { room: "210" });

describe("déplacement au sein d'une même épreuve", () => {
  it("libère l'ancien créneau sans rien demander", () => {
    const ancien = slot("old", { room: "204" });
    const plan = planCandidateMove({
      target: cible,
      enrollments: [enr("e1", ancien)],
      capacity: 1,
      occupied: 0,
    });
    expect(plan).toMatchObject({ ok: true, alreadyHere: false });
    if (plan.ok && !plan.alreadyHere) {
      expect(plan.release.map((r) => r.id)).toEqual(["e1"]);
      expect(plan.from?.id).toBe("old");
    }
  });

  it("l'ancien créneau au MÊME horaire ne compte pas comme conflit", () => {
    // 204 → 210 à 08:30 : le chevauchement est avec le créneau qu'on quitte.
    const plan = planCandidateMove({
      target: cible,
      enrollments: [enr("e1", slot("old", { room: "204" }))],
      capacity: 1,
      occupied: 0,
    });
    expect(plan.ok).toBe(true);
  });

  it("déjà sur le créneau visé → aucune écriture", () => {
    const plan = planCandidateMove({
      target: cible,
      enrollments: [enr("e1", cible)],
      capacity: 1,
      occupied: 1,
    });
    expect(plan).toMatchObject({ ok: true, alreadyHere: true, release: [] });
  });

  it("une inscription annulée ne bloque pas et n'est pas libérée", () => {
    const plan = planCandidateMove({
      target: cible,
      enrollments: [enr("e1", slot("old"), "cancelled")],
      capacity: 1,
      occupied: 0,
    });
    expect(plan).toMatchObject({ ok: true, alreadyHere: false });
    if (plan.ok && !plan.alreadyHere) expect(plan.release).toEqual([]);
  });
});

describe("capacité", () => {
  it("créneau complet → refus explicite", () => {
    const plan = planCandidateMove({
      target: cible,
      enrollments: [],
      capacity: 2,
      occupied: 2,
    });
    expect(plan).toMatchObject({ ok: false, code: "SLOT_FULL" });
    if (!plan.ok) expect(plan.message).toContain("2/2");
  });

  it("capacité nulle (aucun examinateur) → message dédié", () => {
    const plan = planCandidateMove({
      target: cible,
      enrollments: [],
      capacity: 0,
      occupied: 0,
    });
    expect(plan).toMatchObject({ ok: false, code: "SLOT_FULL" });
    if (!plan.ok) expect(plan.message).toContain("aucun examinateur");
  });

  it("force → l'admin passe outre", () => {
    const plan = planCandidateMove({
      target: cible,
      enrollments: [],
      capacity: 1,
      occupied: 1,
      force: true,
    });
    expect(plan.ok).toBe(true);
  });
});

describe("chevauchement avec une AUTRE épreuve", () => {
  const autre = slot("autre", {
    epreuve_id: "ep2",
    epreuve_name: "Business game",
    room: "301",
  });

  it("refusé, avec le créneau en cause dans le message", () => {
    const plan = planCandidateMove({
      target: cible,
      enrollments: [enr("e2", autre)],
      capacity: 1,
      occupied: 0,
    });
    expect(plan).toMatchObject({ ok: false, code: "TIME_CONFLICT" });
    if (!plan.ok) {
      expect(plan.message).toContain("Business game");
      expect(plan.conflict?.id).toBe("autre");
    }
  });

  it("horaires disjoints → aucun conflit", () => {
    const plan = planCandidateMove({
      target: cible,
      enrollments: [enr("e2", { ...autre, start_time: "10:00", end_time: "10:25" })],
      capacity: 1,
      occupied: 0,
    });
    expect(plan.ok).toBe(true);
    if (plan.ok && !plan.alreadyHere) expect(plan.release).toEqual([]);
  });

  it("autre jour → aucun conflit", () => {
    const plan = planCandidateMove({
      target: cible,
      enrollments: [enr("e2", { ...autre, date: "2026-09-16" })],
      capacity: 1,
      occupied: 0,
    });
    expect(plan.ok).toBe(true);
  });

  it("force → le créneau concurrent est libéré lui aussi", () => {
    const plan = planCandidateMove({
      target: cible,
      enrollments: [enr("e2", autre)],
      capacity: 1,
      occupied: 0,
      force: true,
    });
    expect(plan.ok).toBe(true);
    if (plan.ok && !plan.alreadyHere) {
      expect(plan.release.map((r) => r.id)).toEqual(["e2"]);
      // On ne « vient pas » de ce créneau : ce n'est pas la même épreuve.
      expect(plan.from).toBeNull();
    }
  });

  it("créneau complet ET conflit → le complet est annoncé en premier", () => {
    const plan = planCandidateMove({
      target: cible,
      enrollments: [enr("e2", autre)],
      capacity: 1,
      occupied: 1,
    });
    expect(plan).toMatchObject({ ok: false, code: "SLOT_FULL" });
  });
});

describe("describeSlot", () => {
  it("compose date, horaire et salle", () => {
    expect(describeSlot(slot("x"))).toBe("mardi 15 septembre 08:30–08:55 (salle 205)");
  });

  it("créneau inconnu → libellé de repli", () => {
    expect(describeSlot(null)).toBe("un autre créneau");
  });
});
