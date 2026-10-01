import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabaseAdmin: {} }));

import { buildSecondGridStatus } from "@/lib/second-grid";

const PROPALE = {
  title: "Proposition commerciale",
  questions: [
    { q: "Lisibilité", weight: 3 },
    { q: "Fond", weight: 4 },
  ],
};

describe("buildSecondGridStatus", () => {
  it("renvoie null pour une épreuve sans deuxième grille", () => {
    const statusOf = buildSecondGridStatus(
      [{ id: "bg", secondary_grid: null }],
      [],
    );
    expect(statusOf("cand", "bg")).toBeNull();
    expect(statusOf("cand", "inconnue")).toBeNull();
  });

  it("propale pas encore notée : titre de la grille, filled = false", () => {
    const statusOf = buildSecondGridStatus(
      [{ id: "rdv", secondary_grid: PROPALE }],
      [],
    );
    expect(statusOf("cand", "rdv")).toEqual({
      title: "Proposition commerciale",
      filled: false,
    });
  });

  it("une ligne sans aucune note ne compte pas comme notée", () => {
    const statusOf = buildSecondGridStatus(
      [{ id: "rdv", secondary_grid: JSON.stringify(PROPALE) }],
      [{ candidate_id: "cand", epreuve_id: "rdv", scores: { 0: "" } }],
    );
    expect(statusOf("cand", "rdv")).toEqual({
      title: "Proposition commerciale",
      filled: false,
    });
  });

  it("propale notée : filled = true, uniquement pour ce candidat", () => {
    const statusOf = buildSecondGridStatus(
      [{ id: "rdv", secondary_grid: PROPALE }],
      [{ candidate_id: "cand", epreuve_id: "rdv", scores: '{"1": 3}' }],
    );
    expect(statusOf("cand", "rdv")?.filled).toBe(true);
    expect(statusOf("autre", "rdv")?.filled).toBe(false);
  });
});
