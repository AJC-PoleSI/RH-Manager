import { describe, it, expect, vi } from "vitest";
import {
  isFunctionMissingError,
  applyAssignments,
  type DispatchClient,
} from "./dispatch-io";

// ── Mock minimal du client Supabase ──────────────────────────────────
function makeMockClient(rpcError: unknown) {
  const calls = {
    rpc: [] as Array<{ name: string; args: Record<string, unknown> }>,
    delete: [] as Array<{ col: string; vals: string[] }>,
    insert: [] as Array<{ rows: unknown[] }>,
  };
  const client: DispatchClient = {
    rpc: vi.fn(async (name, args) => {
      calls.rpc.push({ name, args });
      return { error: rpcError };
    }),
    from: () => ({
      delete: () => ({
        in: async (col: string, vals: string[]) => {
          calls.delete.push({ col, vals });
          return { error: null };
        },
      }),
      insert: async (rows: unknown[]) => {
        calls.insert.push({ rows });
        return { error: null };
      },
    }),
  };
  return { client, calls };
}

const ASSIGNS = [
  { slot_id: "s1", member_id: "m1" },
  { slot_id: "s1", member_id: "m2" },
];

describe("isFunctionMissingError", () => {
  it("détecte PGRST202 (fonction absente du cache PostgREST)", () => {
    expect(isFunctionMissingError({ code: "PGRST202" })).toBe(true);
  });
  it("détecte 42883 (undefined_function Postgres)", () => {
    expect(isFunctionMissingError({ code: "42883" })).toBe(true);
  });
  it("détecte le message 'Could not find the function'", () => {
    expect(
      isFunctionMissingError({ message: "Could not find the function foo" }),
    ).toBe(true);
  });
  it("ne confond pas une vraie erreur DB", () => {
    expect(isFunctionMissingError({ code: "23505", message: "duplicate" })).toBe(
      false,
    );
  });
  it("gère null/undefined", () => {
    expect(isFunctionMissingError(null)).toBe(false);
    expect(isFunctionMissingError(undefined)).toBe(false);
  });
});

describe("applyAssignments", () => {
  it("chemin ATOMIQUE : RPC OK → aucun delete/insert de repli", async () => {
    const { client, calls } = makeMockClient(null);
    const mode = await applyAssignments(client, ["s1"], ASSIGNS);
    expect(mode).toBe("atomic");
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].args).toEqual({
      p_slot_ids: ["s1"],
      p_assignments: ASSIGNS,
    });
    expect(calls.delete).toHaveLength(0);
    expect(calls.insert).toHaveLength(0);
  });

  it("REPLI : RPC absente → delete + insert non atomiques", async () => {
    const { client, calls } = makeMockClient({ code: "PGRST202" });
    const mode = await applyAssignments(client, ["s1", "s2"], ASSIGNS);
    expect(mode).toBe("fallback");
    expect(calls.delete).toEqual([{ col: "slot_id", vals: ["s1", "s2"] }]);
    expect(calls.insert).toEqual([{ rows: ASSIGNS }]);
  });

  it("ERREUR RÉELLE : propagée, aucun repli (transaction annulée)", async () => {
    const { client, calls } = makeMockClient({ code: "XX000", message: "boom" });
    await expect(applyAssignments(client, ["s1"], ASSIGNS)).rejects.toMatchObject(
      { code: "XX000" },
    );
    expect(calls.delete).toHaveLength(0);
    expect(calls.insert).toHaveLength(0);
  });

  it("NOOP : rien à écrire → pas d'appel RPC", async () => {
    const { client, calls } = makeMockClient(null);
    const mode = await applyAssignments(client, [], []);
    expect(mode).toBe("noop");
    expect(calls.rpc).toHaveLength(0);
  });
});
