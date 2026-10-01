import { describe, it, expect } from "vitest";
import {
  needsWishes,
  selectCandidatesToRemind,
  WISHES_REMINDER_INTERVAL_DAYS,
  WISHES_REMINDER_BODY,
  type ReminderCandidate,
  type ReminderDelib,
} from "./wishes-reminder";

const NOW = new Date("2026-10-02T08:00:00Z");
const DAY_MS = 24 * 3600 * 1000;

function candidate(over: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    id: "c1",
    email: "c1@example.com",
    first_name: "Zoé",
    email_verified: true,
    wishes_locked_at: null,
    wishes_reminded_at: null,
    ...over,
  };
}

function admisT1(over: Partial<ReminderDelib> = {}): ReminderDelib {
  return {
    candidate_id: "c1",
    tour1_status: "accepted",
    tour2_status: "pending",
    tour3_status: "pending",
    ...over,
  };
}

function select(
  c: ReminderCandidate,
  d: ReminderDelib | undefined,
  extra: { wishes?: string[]; tour2Status?: string | null } = {},
) {
  return selectCandidatesToRemind({
    candidates: [c],
    deliberations: d ? [d] : [],
    wishCandidateIds: extra.wishes ?? [],
    tour2Status: extra.tour2Status ?? "en_cours",
    now: NOW,
  });
}

describe("needsWishes", () => {
  it("un admis T1 en lice sans vœu doit remplir ses vœux", () => {
    expect(needsWishes(candidate(), admisT1(), false, "en_cours")).toBe(true);
  });

  it("un candidat qui a déjà des vœux n'a plus rien à remplir", () => {
    expect(needsWishes(candidate(), admisT1(), true, "en_cours")).toBe(false);
  });

  it("sans ligne de délibération, le candidat n'est pas admis T1 : pas de vœux attendus", () => {
    expect(needsWishes(candidate(), undefined, false, "en_cours")).toBe(false);
  });

  it("un refus à n'importe quel tour sort le candidat du périmètre", () => {
    expect(
      needsWishes(candidate(), admisT1({ tour2_status: "refused" }), false, "en_cours"),
    ).toBe(false);
  });

  it("des vœux verrouillés ne sont plus attendus", () => {
    expect(
      needsWishes(
        candidate({ wishes_locked_at: "2026-09-30T10:00:00Z" }),
        admisT1(),
        false,
        "en_cours",
      ),
    ).toBe(false);
  });

  it("une fois le Tour 2 clos, on ne réclame plus les vœux", () => {
    expect(needsWishes(candidate(), admisT1(), false, "termine")).toBe(false);
  });
});

describe("selectCandidatesToRemind", () => {
  it("relance un admis T1, en lice, email vérifié, sans vœu, jamais relancé", () => {
    expect(select(candidate(), admisT1()).map((c) => c.id)).toEqual(["c1"]);
  });

  it("relance à nouveau après l'intervalle de 3 jours", () => {
    const old = new Date(NOW.getTime() - WISHES_REMINDER_INTERVAL_DAYS * DAY_MS);
    expect(
      select(candidate({ wishes_reminded_at: old.toISOString() }), admisT1()),
    ).toHaveLength(1);
  });

  it("ne relance pas un candidat relancé la veille", () => {
    const yesterday = new Date(NOW.getTime() - 1 * DAY_MS);
    expect(
      select(candidate({ wishes_reminded_at: yesterday.toISOString() }), admisT1()),
    ).toHaveLength(0);
  });

  it("exclut un candidat qui a au moins un vœu", () => {
    expect(select(candidate(), admisT1(), { wishes: ["c1"] })).toHaveLength(0);
  });

  it("exclut un refusé", () => {
    expect(select(candidate(), admisT1({ tour1_status: "refused" }))).toHaveLength(0);
    expect(select(candidate(), admisT1({ tour2_status: "refused" }))).toHaveLength(0);
  });

  it("exclut un candidat non admis au T1 (pending ou sans délibération)", () => {
    expect(select(candidate(), admisT1({ tour1_status: "pending" }))).toHaveLength(0);
    expect(select(candidate(), undefined)).toHaveLength(0);
  });

  it("exclut un email non vérifié ou absent (un rappel y partirait dans le vide)", () => {
    expect(select(candidate({ email_verified: false }), admisT1())).toHaveLength(0);
    expect(select(candidate({ email: null }), admisT1())).toHaveLength(0);
  });

  it("tolère l'absence de la colonne email_verified (undefined ≠ non vérifié)", () => {
    expect(select(candidate({ email_verified: undefined }), admisT1())).toHaveLength(1);
  });

  it("exclut des vœux verrouillés", () => {
    expect(
      select(candidate({ wishes_locked_at: "2026-09-30T10:00:00Z" }), admisT1()),
    ).toHaveLength(0);
  });

  it("n'envoie plus rien une fois le Tour 2 terminé", () => {
    expect(select(candidate(), admisT1(), { tour2Status: "termine" })).toHaveLength(0);
  });

  it("traite une liste mixte sans mélanger les délibérations", () => {
    const out = selectCandidatesToRemind({
      candidates: [
        candidate({ id: "a", email: "a@x.fr" }),
        candidate({ id: "b", email: "b@x.fr" }),
        candidate({ id: "c", email: "c@x.fr" }),
      ],
      deliberations: [
        admisT1({ candidate_id: "a" }),
        admisT1({ candidate_id: "b", tour2_status: "refused" }),
        admisT1({ candidate_id: "c" }),
      ],
      wishCandidateIds: new Set(["c"]),
      tour2Status: "en_cours",
      now: NOW,
    });
    expect(out.map((c) => c.id)).toEqual(["a"]);
  });
});

describe("WISHES_REMINDER_BODY", () => {
  it("ne répète pas la salutation : le gabarit d'email l'ajoute déjà", () => {
    expect(WISHES_REMINDER_BODY.startsWith("Bonjour")).toBe(false);
    expect(WISHES_REMINDER_BODY).toContain("Christine Lamaille");
  });
});
