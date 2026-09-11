import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock du client Supabase : chaque table renvoie les lignes configurées,
// quelle que soit la chaîne d'appels (select/eq/limit…). ─────────────────
const rowsByTable: Record<string, unknown[]> = {};

function makeBuilder(table: string) {
  const result = { data: rowsByTable[table] ?? [], error: null };
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    limit: () => builder,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: (table: string) => makeBuilder(table) },
}));

import {
  listEvaluableEpreuveIds,
  resolveCandidateSlot,
} from "./evaluation-access";

beforeEach(() => {
  for (const k of Object.keys(rowsByTable)) delete rowsByTable[k];
});

// Audit du 12/09/2026 : `enrollment.ts` (source unique) considère "active",
// "enrolled" (défaut historique de la colonne) et null comme des inscriptions
// EN COURS ; seul "cancelled" est une désinscription. evaluation-access.ts ne
// reconnaissait que "active"/null : un candidat inscrit avec le statut
// "enrolled" était invisible pour son jury, qui ne pouvait pas le noter.
describe("listEvaluableEpreuveIds — statut d'inscription", () => {
  const cases: Array<[string | null, boolean]> = [
    ["active", true],
    ["enrolled", true],
    [null, true],
    ["cancelled", false],
  ];

  for (const [status, expected] of cases) {
    it(`statut ${String(status)} → ${expected ? "évaluable" : "non évaluable"}`, async () => {
      rowsByTable["slot_member_assignments"] = [
        {
          slot: {
            id: "s1",
            epreuve_id: "ep1",
            enrollments: [{ candidate_id: "c1", status }],
          },
        },
      ];
      const ids = await listEvaluableEpreuveIds("m1", "c1");
      expect(ids.includes("ep1")).toBe(expected);
    });
  }
});

describe("resolveCandidateSlot — statut d'inscription", () => {
  it("trouve le créneau d'une inscription 'enrolled' (défaut de la colonne)", async () => {
    rowsByTable["slot_enrollments"] = [
      { status: "enrolled", slot: { id: "s1", epreuve_id: "ep1" } },
    ];
    expect(await resolveCandidateSlot("c1", "ep1")).toEqual({
      slotId: "s1",
      epreuveId: "ep1",
    });
  });

  it("ignore une inscription annulée", async () => {
    rowsByTable["slot_enrollments"] = [
      { status: "cancelled", slot: { id: "s1", epreuve_id: "ep1" } },
    ];
    expect(await resolveCandidateSlot("c1", "ep1")).toBeNull();
  });
});
