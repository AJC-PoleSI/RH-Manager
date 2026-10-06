import { describe, it, expect } from "vitest";
import { registrationBlockReason, canGradeDistanciel } from "./distanciel";

const NOW = new Date("2026-10-08T10:00:00Z");

const base = {
  action: "register" as const,
  isDistanciel: true,
  tourStatus: "en_cours",
  planningVisible: true,
  deadline: null as string | null,
  now: NOW,
};

describe("registrationBlockReason", () => {
  it("épreuve en distanciel, tour en cours, planning ouvert → autorisé", () => {
    expect(registrationBlockReason(base)).toBeNull();
  });

  it("épreuve en présentiel → refusé (on s'inscrit sur un créneau)", () => {
    expect(registrationBlockReason({ ...base, isDistanciel: false })).toMatch(
      /créneau/,
    );
  });

  it("tour pas encore commencé → refusé", () => {
    expect(registrationBlockReason({ ...base, tourStatus: "a_venir" })).toMatch(
      /pas encore commencé/,
    );
  });

  it("tour terminé → refusé, à l'inscription comme à la désinscription", () => {
    expect(registrationBlockReason({ ...base, tourStatus: "termine" })).toMatch(
      /terminé/,
    );
    expect(
      registrationBlockReason({ ...base, action: "unregister", tourStatus: "termine" }),
    ).toMatch(/terminé/);
  });

  it("planning pas encore ouvert aux candidats → refusé", () => {
    expect(registrationBlockReason({ ...base, planningVisible: false })).toMatch(
      /pas encore ouvertes/,
    );
  });

  it("deadline à venir → autorisé", () => {
    expect(
      registrationBlockReason({ ...base, deadline: "2026-10-09T10:00:00Z" }),
    ).toBeNull();
  });

  it("deadline passée → inscription refusée", () => {
    expect(
      registrationBlockReason({ ...base, deadline: "2026-10-07T10:00:00Z" }),
    ).toMatch(/fermées depuis le/);
  });

  it("deadline passée → désinscription refusée aussi", () => {
    expect(
      registrationBlockReason({
        ...base,
        action: "unregister",
        deadline: "2026-10-07T10:00:00Z",
      }),
    ).toMatch(/désinscription n'est plus possible/);
  });

  it("deadline illisible → ignorée plutôt que de bloquer tout le monde", () => {
    expect(registrationBlockReason({ ...base, deadline: "pas une date" })).toBeNull();
  });
});

describe("canGradeDistanciel", () => {
  const ok = {
    isDistanciel: true,
    isPoleTest: true,
    pole: "Marketing",
    memberPole: "Marketing",
    registered: true,
  };

  it("membre du pôle, candidat inscrit → peut noter", () => {
    expect(canGradeDistanciel(ok)).toBe(true);
  });

  it("pôle comparé sans casse ni accents", () => {
    expect(
      canGradeDistanciel({ ...ok, pole: "Système d'information", memberPole: "systeme d'information" }),
    ).toBe(true);
  });

  it("membre d'un autre pôle → non", () => {
    expect(canGradeDistanciel({ ...ok, memberPole: "Trésorerie" })).toBe(false);
  });

  it("membre sans pôle → non", () => {
    expect(canGradeDistanciel({ ...ok, memberPole: null })).toBe(false);
  });

  it("candidat non inscrit → non", () => {
    expect(canGradeDistanciel({ ...ok, registered: false })).toBe(false);
  });

  it("épreuve en présentiel → non (la règle du créneau partagé s'applique)", () => {
    expect(canGradeDistanciel({ ...ok, isDistanciel: false })).toBe(false);
  });

  it("épreuve distancielle hors pôle → réservée aux admins", () => {
    expect(canGradeDistanciel({ ...ok, isPoleTest: false, pole: null })).toBe(false);
  });
});
