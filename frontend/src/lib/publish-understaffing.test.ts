import { describe, it, expect } from "vitest";
import {
  planPublication,
  publishedCount,
  summarizePublication,
  DEFAULT_MIN_MEMBERS,
  todayInParis,
  type PendingSlotLike,
} from "./publish-understaffing";

/** Raccourci : un créneau avec `n` examinateurs et un quota de `target`. */
const slot = (
  id: string,
  n: number,
  target?: number | null,
  extra: Partial<PendingSlotLike> = {},
): PendingSlotLike => ({
  id,
  members: Array.from({ length: n }, (_, i) => ({ member_id: `m${i}` })),
  min_members: target === undefined ? 6 : target,
  ...extra,
});

describe("planPublication — jury au complet", () => {
  it("publie un créneau dont l'effectif atteint le quota", () => {
    const plan = planPublication([slot("a", 6, 6)]);
    expect(plan.staffed).toEqual(["a"]);
    expect(plan.understaffed).toEqual([]);
    expect(plan.heldUnderstaffed).toEqual([]);
  });

  it("publie aussi un créneau en sur-effectif", () => {
    const plan = planPublication([slot("a", 7, 6)]);
    expect(plan.staffed).toEqual(["a"]);
  });

  it("retombe sur le quota par défaut quand min_members est absent", () => {
    const plan = planPublication([slot("a", DEFAULT_MIN_MEMBERS, null)]);
    expect(plan.staffed).toEqual(["a"]);
    // Un cran en dessous du défaut → retenu.
    const under = planPublication([slot("b", DEFAULT_MIN_MEMBERS - 1, null)]);
    expect(under.staffed).toEqual([]);
    expect(under.heldUnderstaffed[0]?.target).toBe(DEFAULT_MIN_MEMBERS);
  });
});

describe("planPublication — case NON cochée (comportement historique)", () => {
  it("retient un créneau sous son quota au lieu de le publier", () => {
    const plan = planPublication([slot("a", 5, 6)]);
    expect(plan.staffed).toEqual([]);
    expect(plan.understaffed).toEqual([]);
    expect(plan.heldUnderstaffed).toHaveLength(1);
    expect(plan.heldUnderstaffed[0]).toMatchObject({
      slotId: "a",
      assigned: 5,
      target: 6,
    });
  });

  it("ne publie rien de nouveau par rapport à avant la fonctionnalité", () => {
    const plan = planPublication([slot("a", 5, 6), slot("b", 0, 6)]);
    expect(publishedCount(plan)).toBe(0);
  });
});

describe("planPublication — case cochée", () => {
  it("publie le créneau sous-effectif et ramène le quota à l'effectif", () => {
    const plan = planPublication([slot("a", 5, 6)], {
      allowUnderstaffed: true,
    });
    expect(plan.heldUnderstaffed).toEqual([]);
    expect(plan.understaffed).toHaveLength(1);
    expect(plan.understaffed[0]).toMatchObject({
      slotId: "a",
      assigned: 5,
      target: 6,
    });
    expect(publishedCount(plan)).toBe(1);
  });

  it("ne touche PAS au quota des créneaux déjà au complet", () => {
    const plan = planPublication([slot("a", 6, 6)], {
      allowUnderstaffed: true,
    });
    expect(plan.staffed).toEqual(["a"]);
    expect(plan.understaffed).toEqual([]);
  });

  it("REFUSE un créneau à zéro examinateur, même case cochée", () => {
    const plan = planPublication([slot("vide", 0, 6)], {
      allowUnderstaffed: true,
    });
    expect(plan.understaffed).toEqual([]);
    expect(plan.staffed).toEqual([]);
    expect(plan.noExaminer).toHaveLength(1);
    expect(plan.noExaminer[0].slotId).toBe("vide");
    expect(publishedCount(plan)).toBe(0);
  });

  it("trie correctement un lot mélangé (cas réel du business game)", () => {
    // Mardi 22/09 : 2 créneaux à 5/6 en salle 235, 4 créneaux vides ailleurs.
    const plan = planPublication(
      [
        slot("235-16h00", 5, 6),
        slot("235-16h55", 5, 6),
        slot("242-16h00", 0, 6),
        slot("238-16h00", 0, 6),
        slot("242-16h55", 0, 6),
        slot("238-16h55", 0, 6),
      ],
      { allowUnderstaffed: true },
    );
    expect(plan.understaffed.map((s) => s.slotId)).toEqual([
      "235-16h00",
      "235-16h55",
    ]);
    expect(plan.noExaminer).toHaveLength(4);
    expect(publishedCount(plan)).toBe(2);
  });
});

describe("planPublication — robustesse des entrées", () => {
  it("gère une liste absente", () => {
    expect(publishedCount(planPublication(null))).toBe(0);
    expect(publishedCount(planPublication(undefined))).toBe(0);
  });

  it("ignore une ligne sans id", () => {
    const plan = planPublication([{ id: "", members: [], min_members: 2 }]);
    expect(plan.noExaminer).toEqual([]);
    expect(publishedCount(plan)).toBe(0);
  });

  it("gère l'absence de liste de membres", () => {
    const plan = planPublication([{ id: "a", min_members: 6 }]);
    expect(plan.noExaminer).toHaveLength(1);
  });

  it("accepte la graphie camelCase du client", () => {
    const plan = planPublication(
      [
        {
          id: "a",
          members: [{}, {}, {}, {}, {}],
          minMembers: 6,
          startTime: "16:00",
          date: "2026-09-22",
          room: "235",
        },
      ],
      { allowUnderstaffed: true },
    );
    expect(plan.understaffed[0]).toMatchObject({
      assigned: 5,
      target: 6,
      startTime: "16:00",
      room: "235",
    });
  });
});

describe("planPublication — garde-fou des dates passées", () => {
  const jour = (d: string) => ({ date: `${d}T12:00:00+00:00` });

  it("écarte un créneau sous-effectif déjà passé, même case cochée", () => {
    const plan = planPublication(
      [slot("hier", 3, 6, jour("2026-09-20"))],
      { allowUnderstaffed: true, today: "2026-09-21" },
    );
    expect(plan.understaffed).toEqual([]);
    expect(plan.pastUnderstaffed).toHaveLength(1);
    expect(publishedCount(plan)).toBe(0);
  });

  it("garde le jour même et les jours suivants", () => {
    const plan = planPublication(
      [
        slot("aujourdhui", 3, 6, jour("2026-09-21")),
        slot("demain", 5, 6, jour("2026-09-22")),
      ],
      { allowUnderstaffed: true, today: "2026-09-21" },
    );
    expect(plan.understaffed.map((s) => s.slotId)).toEqual([
      "aujourdhui",
      "demain",
    ]);
    expect(plan.pastUnderstaffed).toEqual([]);
  });

  it("ne filtre PAS les créneaux au jury complet (comportement historique)", () => {
    const plan = planPublication([slot("hier", 6, 6, jour("2026-09-01"))], {
      allowUnderstaffed: true,
      today: "2026-09-21",
    });
    expect(plan.staffed).toEqual(["hier"]);
  });

  it("sans `today`, aucun filtre de date n'est appliqué", () => {
    const plan = planPublication([slot("hier", 3, 6, jour("2020-01-01"))], {
      allowUnderstaffed: true,
    });
    expect(plan.understaffed).toHaveLength(1);
    expect(plan.pastUnderstaffed).toEqual([]);
  });

  it("tolère une date absente (créneau conservé, pas écarté par erreur)", () => {
    const plan = planPublication([slot("sans-date", 3, 6)], {
      allowUnderstaffed: true,
      today: "2026-09-21",
    });
    expect(plan.understaffed).toHaveLength(1);
  });

  it("cas réel : mardi passe, la semaine dernière est écartée", () => {
    const plan = planPublication(
      [
        slot("14/09-242", 3, 6, jour("2026-09-14")),
        slot("15/09-242", 2, 6, jour("2026-09-15")),
        slot("18/09-242", 3, 6, jour("2026-09-18")),
        slot("22/09-235-16h00", 5, 6, jour("2026-09-22")),
        slot("22/09-235-16h55", 5, 6, jour("2026-09-22")),
      ],
      { allowUnderstaffed: true, today: "2026-09-21" },
    );
    expect(plan.understaffed.map((s) => s.slotId)).toEqual([
      "22/09-235-16h00",
      "22/09-235-16h55",
    ]);
    expect(plan.pastUnderstaffed).toHaveLength(3);
    expect(publishedCount(plan)).toBe(2);
  });
});

describe("summarizePublication", () => {
  it("nomme le sous-effectif assumé sans le fondre dans le total", () => {
    const plan = planPublication([slot("a", 6, 6), slot("b", 5, 6)], {
      allowUnderstaffed: true,
    });
    const msg = summarizePublication(plan);
    expect(msg).toContain("2 créneau(x) publié(s)");
    expect(msg).toContain("1 en sous-effectif assumé");
  });

  it("distingue « en attente d'un jury » de « sans aucun examinateur »", () => {
    const plan = planPublication([slot("a", 5, 6), slot("b", 0, 6)]);
    const msg = summarizePublication(plan);
    expect(msg).toContain("1 en attente d'un jury complet");
    expect(msg).toContain("1 sans aucun examinateur");
  });

  it("le dit quand il n'y a rien à publier", () => {
    expect(summarizePublication(planPublication([]))).toBe(
      "Aucun nouveau créneau à publier",
    );
  });
});

describe("todayInParis", () => {
  it("formate en YYYY-MM-DD", () => {
    expect(todayInParis()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("rend la date PARISIENNE, pas celle du runtime en UTC", () => {
    // 21/09/2026 23:30 UTC = 22/09/2026 01:30 à Paris (UTC+2 en septembre).
    expect(todayInParis(new Date("2026-09-21T23:30:00Z"))).toBe("2026-09-22");
  });

  it("reste stable en journée", () => {
    expect(todayInParis(new Date("2026-09-22T10:00:00Z"))).toBe("2026-09-22");
  });
});
