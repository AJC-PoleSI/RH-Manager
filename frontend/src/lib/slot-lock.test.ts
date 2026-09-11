import { describe, it, expect } from "vitest";
import {
  isSlotLocked,
  lockReasonLabel,
  lockPatch,
  unlockPatch,
  isMissingColumnError,
} from "./slot-lock";

describe("isSlotLocked", () => {
  it("verrouillé quand is_locked vaut true", () => {
    expect(isSlotLocked({ is_locked: true })).toBe(true);
  });

  it("libre quand is_locked vaut false", () => {
    expect(isSlotLocked({ is_locked: false })).toBe(false);
  });

  // Migration pas encore appliquée : la colonne n'est pas dans la réponse.
  // Un créneau sans verrou connu est LIBRE — le dispatch continue de tourner
  // exactement comme avant, plutôt que de tout figer par prudence.
  it("libre quand la colonne est absente (undefined / null)", () => {
    expect(isSlotLocked({})).toBe(false);
    expect(isSlotLocked({ is_locked: null })).toBe(false);
    expect(isSlotLocked(null)).toBe(false);
    expect(isSlotLocked(undefined)).toBe(false);
  });

  it("ne se laisse pas berner par une valeur non booléenne", () => {
    expect(isSlotLocked({ is_locked: "true" as unknown as boolean })).toBe(
      false,
    );
  });
});

describe("lockReasonLabel", () => {
  it("traduit chaque motif connu", () => {
    expect(lockReasonLabel("publication")).toBe(
      "Planning publié aux candidats",
    );
    expect(lockReasonLabel("inscription")).toBe("Un candidat est inscrit");
    expect(lockReasonLabel("manuel")).toBe("Figé manuellement");
  });

  it("reste lisible sur un motif inconnu ou absent", () => {
    expect(lockReasonLabel(null)).toBe("Créneau figé");
    expect(lockReasonLabel("n_importe_quoi")).toBe("Créneau figé");
  });
});

describe("lockPatch / unlockPatch", () => {
  it("pose le verrou avec son motif et son horodatage", () => {
    const patch = lockPatch("publication");
    expect(patch.is_locked).toBe(true);
    expect(patch.locked_reason).toBe("publication");
    expect(Number.isNaN(Date.parse(patch.locked_at))).toBe(false);
  });

  it("efface motif et horodatage au déverrouillage", () => {
    expect(unlockPatch()).toEqual({
      is_locked: false,
      locked_at: null,
      locked_reason: null,
    });
  });
});

describe("isMissingColumnError", () => {
  it("reconnaît le code Postgres undefined_column", () => {
    expect(isMissingColumnError({ code: "42703" })).toBe(true);
  });

  it("reconnaît le code PostgREST de cache de schéma", () => {
    expect(isMissingColumnError({ code: "PGRST204" })).toBe(true);
  });

  it("reconnaît le message en clair", () => {
    expect(
      isMissingColumnError({
        message: 'column evaluation_slots.is_locked does not exist',
      }),
    ).toBe(true);
    expect(
      isMissingColumnError({
        message: "Could not find the 'is_locked' column of 'evaluation_slots'",
      }),
    ).toBe(true);
  });

  // Sans ça, une panne réelle (droits, réseau, colonne mal orthographiée
  // ailleurs) serait avalée comme « migration pas encore appliquée » et le
  // verrou échouerait en silence.
  it("ne confond pas une vraie erreur avec une colonne absente", () => {
    expect(isMissingColumnError({ code: "42501" })).toBe(false);
    expect(isMissingColumnError({ message: "permission denied" })).toBe(false);
    expect(isMissingColumnError({ message: "relation does not exist" })).toBe(
      false,
    );
    expect(isMissingColumnError(null)).toBe(false);
    expect(isMissingColumnError("boom")).toBe(false);
  });
});
