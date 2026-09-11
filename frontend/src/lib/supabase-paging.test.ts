import { describe, it, expect, vi } from "vitest";
import { fetchAllRows, PAGE_SIZE } from "./supabase-paging";

/** Fausse table : renvoie la tranche demandée, comme le ferait `.range()`. */
function makeTable(rowCount: number, pageSize = PAGE_SIZE) {
  const rows = Array.from({ length: rowCount }, (_, i) => ({ id: `r${i}` }));
  const calls: Array<[number, number]> = [];
  const query = vi.fn(async (from: number, to: number) => {
    calls.push([from, to]);
    return { data: rows.slice(from, to + 1), error: null };
  });
  return { rows, calls, query, pageSize };
}

describe("fetchAllRows", () => {
  it("renvoie toutes les lignes au-delà du plafond de 1000", async () => {
    const { rows, query } = makeTable(1076);

    const { data, error } = await fetchAllRows(query);

    expect(error).toBeNull();
    expect(data).toHaveLength(1076);
    expect(data).toEqual(rows);
  });

  it("demande bien une deuxième page quand la première est pleine", async () => {
    const { calls, query } = makeTable(1076);

    await fetchAllRows(query);

    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("s'arrête à la première page incomplète", async () => {
    const { calls, query } = makeTable(42);

    const { data } = await fetchAllRows(query);

    expect(data).toHaveLength(42);
    expect(calls).toEqual([[0, 999]]);
  });

  it("fait exactement un tour de plus quand le total est un multiple de la page", async () => {
    // 2000 lignes = deux pages PLEINES : impossible de savoir que la seconde
    // est la dernière sans en demander une troisième, qui revient vide.
    const { calls, query } = makeTable(2000);

    const { data } = await fetchAllRows(query);

    expect(data).toHaveLength(2000);
    expect(calls).toHaveLength(3);
  });

  it("propage la première erreur sans données partielles", async () => {
    const boom = { code: "42703", message: "column does not exist" };
    const query = vi.fn(async (from: number) =>
      from === 0
        ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}` })), error: null }
        : { data: null, error: boom },
    );

    const { data, error } = await fetchAllRows(query);

    // Surtout PAS de données partielles : l'appelant retomberait sur une vue
    // tronquée, exactement le bug qu'on corrige.
    expect(data).toBeNull();
    expect(error).toBe(boom);
  });

  it("remonte l'erreur de la toute première page (colonne absente)", async () => {
    const boom = { code: "PGRST204", message: "epreuve_id not found" };
    const query = vi.fn(async () => ({ data: null, error: boom }));

    const { data, error } = await fetchAllRows(query);

    expect(data).toBeNull();
    expect(error).toBe(boom);
  });

  it("gère une table vide", async () => {
    const { query } = makeTable(0);

    const { data, error } = await fetchAllRows(query);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("accepte une taille de page réduite (utile en test)", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}` }));
    const query = vi.fn(async (from: number, to: number) => ({
      data: rows.slice(from, to + 1),
      error: null,
    }));

    const { data } = await fetchAllRows(query, 3);

    expect(data).toHaveLength(7);
    expect(query).toHaveBeenCalledTimes(3); // 3 + 3 + 1
  });

  it("s'arrête et signale une requête qui ne progresse jamais", async () => {
    // Requête pathologique : toujours une page pleine (ordre non déterministe).
    const page = Array.from({ length: 2 }, (_, i) => ({ id: `r${i}` }));
    const query = vi.fn(async () => ({ data: page, error: null }));

    const { data, error } = await fetchAllRows(query, 2);

    expect(data).toBeNull();
    expect(String((error as Error).message)).toContain("pages atteintes");
  });
});
