import { describe, it, expect } from "vitest";
import { statusAfterRelease } from "./slot-release";

describe("statusAfterRelease", () => {
  it("planning visible + au moins un examinateur → republié", () => {
    expect(
      statusAfterRelease({ planningVisible: true, memberCount: 1, minMembers: 2 }),
    ).toBe("published");
  });

  it("planning masqué mais jury au complet → prêt", () => {
    expect(
      statusAfterRelease({ planningVisible: false, memberCount: 2, minMembers: 2 }),
    ).toBe("ready");
  });

  it("jury incomplet → retour au pool", () => {
    expect(
      statusAfterRelease({ planningVisible: false, memberCount: 1, minMembers: 2 }),
    ).toBe("open");
  });

  it("planning visible mais plus aucun examinateur → retour au pool", () => {
    expect(
      statusAfterRelease({ planningVisible: true, memberCount: 0, minMembers: 2 }),
    ).toBe("open");
  });
});
