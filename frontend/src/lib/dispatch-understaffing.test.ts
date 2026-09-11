import { describe, it, expect } from "vitest";
import {
  activeEnrollmentCount,
  slotStatusAfterDispatch,
  isNewlyUnderstaffed,
  formatSlotLabel,
  buildUnderstaffedNotifications,
  MAX_LISTED,
  type UnderstaffedSlot,
} from "./dispatch-understaffing";

// ─── activeEnrollmentCount ────────────────────────────────────────────
describe("activeEnrollmentCount", () => {
  it("compte les inscriptions actives", () => {
    expect(
      activeEnrollmentCount([{ status: "active" }, { status: "active" }]),
    ).toBe(2);
  });

  it("traite un statut absent comme actif (lignes historiques)", () => {
    expect(activeEnrollmentCount([{}, { status: null }])).toBe(2);
  });

  it("ignore les inscriptions annulées", () => {
    expect(
      activeEnrollmentCount([{ status: "active" }, { status: "cancelled" }]),
    ).toBe(1);
  });

  it("gère l'absence de liste", () => {
    expect(activeEnrollmentCount(undefined)).toBe(0);
    expect(activeEnrollmentCount(null)).toBe(0);
    expect(activeEnrollmentCount([])).toBe(0);
  });
});

// ─── slotStatusAfterDispatch ──────────────────────────────────────────
describe("slotStatusAfterDispatch", () => {
  const base = { minMembers: 2, planningVisible: true };

  it("publie un créneau au complet quand le planning est ouvert", () => {
    expect(
      slotStatusAfterDispatch({ ...base, assigned: 2, candidates: 0 }),
    ).toBe("published");
  });

  it("met un créneau au complet en 'ready' quand le planning est fermé", () => {
    expect(
      slotStatusAfterDispatch({
        ...base,
        planningVisible: false,
        assigned: 2,
        candidates: 0,
      }),
    ).toBe("ready");
  });

  it("GARDE en circulation un créneau à 1 examinateur AVEC candidat inscrit", () => {
    // Le cœur du changement : avant, ce créneau retombait en "open" et
    // sortait de la liste de réservation.
    expect(
      slotStatusAfterDispatch({ ...base, assigned: 1, candidates: 1 }),
    ).toBe("published");
  });

  it("garde ce même créneau en 'ready' si le planning est fermé", () => {
    expect(
      slotStatusAfterDispatch({
        ...base,
        planningVisible: false,
        assigned: 1,
        candidates: 1,
      }),
    ).toBe("ready");
  });

  it("rétrograde un créneau à 1 examinateur SANS candidat", () => {
    expect(
      slotStatusAfterDispatch({ ...base, assigned: 1, candidates: 0 }),
    ).toBe("open");
  });

  it("rétrograde un créneau à ZÉRO examinateur même avec un candidat", () => {
    // Fermé aux nouvelles inscriptions ; le candidat déjà inscrit continue de
    // le voir (/api/slots/available inclut ses propres créneaux).
    expect(
      slotStatusAfterDispatch({ ...base, assigned: 0, candidates: 1 }),
    ).toBe("open");
  });

  it("respecte un quota différent de 2", () => {
    expect(
      slotStatusAfterDispatch({
        minMembers: 4,
        planningVisible: true,
        assigned: 3,
        candidates: 2,
      }),
    ).toBe("published");
    expect(
      slotStatusAfterDispatch({
        minMembers: 4,
        planningVisible: true,
        assigned: 3,
        candidates: 0,
      }),
    ).toBe("open");
  });
});

// ─── isNewlyUnderstaffed ──────────────────────────────────────────────
describe("isNewlyUnderstaffed", () => {
  it("détecte la bascule complet → incomplet", () => {
    expect(isNewlyUnderstaffed(2, 1, 2)).toBe(true);
  });

  it("ne renotifie pas un créneau déjà incomplet", () => {
    expect(isNewlyUnderstaffed(1, 1, 2)).toBe(false);
    expect(isNewlyUnderstaffed(0, 0, 2)).toBe(false);
  });

  it("ne signale rien quand le créneau reste complet", () => {
    expect(isNewlyUnderstaffed(2, 3, 2)).toBe(false);
  });

  it("ne signale rien quand le créneau se remplit", () => {
    expect(isNewlyUnderstaffed(1, 2, 2)).toBe(false);
  });
});

// ─── formatSlotLabel ──────────────────────────────────────────────────
describe("formatSlotLabel", () => {
  const slot = (over: Partial<UnderstaffedSlot>): UnderstaffedSlot => ({
    slotId: "s1",
    date: "2026-09-16",
    startTime: "15:30",
    room: "205",
    assigned: 1,
    needed: 2,
    candidates: 1,
    ...over,
  });

  it("formate jour, date, heure et salle", () => {
    expect(formatSlotLabel(slot({}))).toBe("mer. 16/09 15h30 — salle 205");
  });

  it("accepte une date ISO complète et une heure avec secondes", () => {
    expect(
      formatSlotLabel(
        slot({ date: "2026-09-21T00:00:00.000Z", startTime: "19:30:00" }),
      ),
    ).toBe("lun. 21/09 19h30 — salle 205");
  });

  it("omet la salle quand elle est absente", () => {
    expect(formatSlotLabel(slot({ room: null }))).toBe("mer. 16/09 15h30");
    expect(formatSlotLabel(slot({ room: "  " }))).toBe("mer. 16/09 15h30");
  });
});

// ─── buildUnderstaffedNotifications ───────────────────────────────────
describe("buildUnderstaffedNotifications", () => {
  const mk = (over: Partial<UnderstaffedSlot>): UnderstaffedSlot => ({
    slotId: Math.random().toString(36).slice(2),
    date: "2026-09-16",
    startTime: "15:30",
    room: "205",
    assigned: 1,
    needed: 2,
    candidates: 1,
    ...over,
  });

  it("ne produit rien quand il n'y a rien à signaler", () => {
    expect(buildUnderstaffedNotifications([])).toEqual([]);
  });

  it("ignore les créneaux sans candidat inscrit", () => {
    expect(buildUnderstaffedNotifications([mk({ candidates: 0 })])).toEqual([]);
  });

  it("produit l'alerte sous-effectif pour un créneau à 1 examinateur", () => {
    const [notif] = buildUnderstaffedNotifications([mk({ assigned: 1 })]);

    expect(notif.type).toBe("slot_understaffed");
    expect(notif.title).toBe("Créneaux à compléter");
    expect(notif.body).toContain("1 créneau ");
    expect(notif.body).toContain("mer. 16/09 15h30 — salle 205");
    expect(notif.link).toBe("/dashboard/availability");
  });

  it("produit une alerte CRITIQUE distincte pour un créneau à 0 examinateur", () => {
    const notifs = buildUnderstaffedNotifications([mk({ assigned: 0 })]);

    expect(notifs).toHaveLength(1);
    expect(notifs[0].type).toBe("slot_no_examiner");
    expect(notifs[0].title).toContain("CRITIQUE");
  });

  it("sépare les deux populations en deux notifications", () => {
    const notifs = buildUnderstaffedNotifications([
      mk({ assigned: 1 }),
      mk({ assigned: 0 }),
    ]);

    expect(notifs.map((n) => n.type)).toEqual([
      "slot_understaffed",
      "slot_no_examiner",
    ]);
  });

  it("accorde le pluriel", () => {
    const [notif] = buildUnderstaffedNotifications([
      mk({ assigned: 1 }),
      mk({ assigned: 1, startTime: "19:30" }),
    ]);

    expect(notif.body).toContain("2 créneaux");
    expect(notif.body).toContain("ont");
  });

  it("tronque au-delà de 5 créneaux", () => {
    const slots = Array.from({ length: 8 }, (_, i) =>
      mk({ assigned: 1, startTime: `1${i}:00` }),
    );

    const [notif] = buildUnderstaffedNotifications(slots);

    expect(notif.body).toContain("et 3 autres");
    expect(notif.body.match(/salle 205/g)).toHaveLength(MAX_LISTED);
  });

  it("accorde 'autre' au singulier", () => {
    const slots = Array.from({ length: MAX_LISTED + 1 }, (_, i) =>
      mk({ assigned: 1, startTime: `1${i}:00` }),
    );

    const [notif] = buildUnderstaffedNotifications(slots);

    expect(notif.body).toContain("et 1 autre.");
  });
});
