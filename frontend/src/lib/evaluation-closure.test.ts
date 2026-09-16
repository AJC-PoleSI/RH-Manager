import { describe, expect, it } from "vitest";
import {
  buildClosureIndex,
  evaluationClosure,
  hasAnyEvaluation,
  parisClock,
  slotHasEnded,
} from "@/lib/evaluation-closure";

const BG = "epreuve-bg";
const ENTRETIEN = "epreuve-entretien";
const isGroupEpreuve = (id: string) => id === BG;

const CAND = "cand-1";
const MOI = "membre-moi";
const AUTRE = "membre-autre";

/** Ligne aboutie par défaut (une note renseignée). */
function row(over: Record<string, unknown> = {}) {
  return {
    candidate_id: CAND,
    epreuve_id: ENTRETIEN,
    member_id: MOI,
    is_group: false,
    scores: { "0": 4 },
    comment: "",
    ...over,
  };
}

function verdict(rows: any[], epreuveId: string, memberId = MOI) {
  const index = buildClosureIndex(rows, isGroupEpreuve);
  return evaluationClosure(index, {
    candidateId: CAND,
    epreuveId,
    memberId,
    isGroupEpreuve: isGroupEpreuve(epreuveId),
  });
}

describe("evaluationClosure", () => {
  it("laisse ouvert quand rien n'a été saisi", () => {
    expect(verdict([], ENTRETIEN).closed).toBe(false);
  });

  it("clôt pour l'auteur de son propre avis individuel", () => {
    expect(verdict([row()], ENTRETIEN)).toEqual({
      closed: true,
      reason: "mine",
      byMemberId: MOI,
    });
  });

  it("laisse ouvert pour un autre examinateur sur une épreuve individuelle", () => {
    expect(verdict([row({ member_id: AUTRE })], ENTRETIEN).closed).toBe(false);
  });

  it("clôt pour les DEUX examinateurs quand la note de binôme existe", () => {
    const shared = [row({ is_group: true, member_id: AUTRE })];
    // Le co-examinateur qui n'a rien saisi est couvert lui aussi : c'est le
    // bug qui reproposait les 15 entretiens du tour 1.
    expect(verdict(shared, ENTRETIEN)).toEqual({
      closed: true,
      reason: "shared",
      byMemberId: AUTRE,
    });
    expect(verdict(shared, ENTRETIEN, AUTRE).reason).toBe("mine");
  });

  it("clôt un candidat de business game dès qu'un pair l'a noté", () => {
    const peer = [row({ epreuve_id: BG, member_id: AUTRE })];
    expect(verdict(peer, BG)).toEqual({
      closed: true,
      reason: "peer",
      byMemberId: AUTRE,
    });
  });

  it("ignore une ANCIENNE note collective de business game", () => {
    // Elle note le groupe, pas le candidat : celui-ci reste à évaluer.
    const legacy = [row({ epreuve_id: BG, is_group: true, member_id: AUTRE })];
    expect(verdict(legacy, BG).closed).toBe(false);
    expect(hasAnyEvaluation(buildClosureIndex(legacy, isGroupEpreuve), CAND, BG)).toBe(
      false,
    );
  });

  it("ignore une ligne vide (ghost lock de l'audit #4)", () => {
    const ghost = [row({ scores: {}, comment: "" })];
    expect(verdict(ghost, ENTRETIEN).closed).toBe(false);
  });

  it("retient une ligne sans note mais avec commentaire", () => {
    expect(verdict([row({ scores: {}, comment: "très bon" })], ENTRETIEN).closed).toBe(
      true,
    );
  });

  it("lit les scores stockés en chaîne JSON", () => {
    expect(verdict([row({ scores: '{"0":3}' })], ENTRETIEN).closed).toBe(true);
  });

  it("ne mélange pas deux épreuves du même candidat", () => {
    expect(verdict([row()], BG).closed).toBe(false);
  });

  it("annonce ma propre note plutôt que la note partagée", () => {
    const rows = [row(), row({ is_group: true, member_id: AUTRE })];
    expect(verdict(rows, ENTRETIEN).reason).toBe("mine");
  });
});

describe("hasAnyEvaluation", () => {
  it("voit la note d'un pair même si elle ne me concerne pas", () => {
    const index = buildClosureIndex([row({ member_id: AUTRE })], isGroupEpreuve);
    expect(hasAnyEvaluation(index, CAND, ENTRETIEN)).toBe(true);
    expect(hasAnyEvaluation(index, "cand-2", ENTRETIEN)).toBe(false);
  });
});

describe("slotHasEnded", () => {
  const now = "2026-09-16 18:00";

  it("considère terminé un créneau de la veille", () => {
    expect(
      slotHasEnded({ date: "2026-09-15T12:00:00+00:00", end_time: "18:45" }, now),
    ).toBe(true);
  });

  it("considère en cours un créneau qui finit plus tard", () => {
    expect(
      slotHasEnded({ date: "2026-09-16T12:00:00+00:00", end_time: "18:45" }, now),
    ).toBe(false);
  });

  it("considère terminé un créneau qui finit à l'instant", () => {
    expect(
      slotHasEnded({ date: "2026-09-16T12:00:00+00:00", end_time: "18:00" }, now),
    ).toBe(true);
  });

  it("accepte une heure avec les secondes", () => {
    expect(
      slotHasEnded({ date: "2026-09-16T12:00:00+00:00", end_time: "16:55:00" }, now),
    ).toBe(true);
  });

  it("ne conclut rien sans date ni heure de fin", () => {
    expect(slotHasEnded({ date: null, end_time: "16:55" }, now)).toBe(false);
    expect(slotHasEnded({ date: "2026-09-16T12:00:00+00:00", end_time: "" }, now)).toBe(
      false,
    );
  });
});

describe("parisClock", () => {
  it("rend une horloge murale parisienne comparable", () => {
    // 16/09/2026 12:00 UTC = 14:00 à Paris (heure d'été).
    expect(parisClock(new Date("2026-09-16T12:00:00Z"))).toBe("2026-09-16 14:00");
    // 16/01/2026 12:00 UTC = 13:00 à Paris (heure d'hiver).
    expect(parisClock(new Date("2026-01-16T12:00:00Z"))).toBe("2026-01-16 13:00");
  });
});
