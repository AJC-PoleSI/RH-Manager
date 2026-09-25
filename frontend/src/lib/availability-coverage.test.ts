import { describe, it, expect } from "vitest";
import { availabilityCoverage, coverageWarning } from "./availability-coverage";

const members = [
  { id: "romain", name: "Romain Messein" },
  { id: "baptiste", name: "Baptiste LeBec" },
  { id: "samy", name: "Samy Kirat" },
  { id: "christine", name: "Christine Lamaille" },
];
const participantIds = new Set(["romain", "baptiste", "samy"]);
const range = { from: "2026-09-25", to: "2026-10-02" };

describe("availabilityCoverage", () => {
  it("compte ceux qui ont au moins une dispo sur les jours du tour", () => {
    const r = availabilityCoverage({
      members,
      participantIds,
      range,
      availabilities: [
        { member_id: "romain", date: "2026-09-29T12:00:00+00:00" },
        { member_id: "romain", date: "2026-09-30T12:00:00+00:00" },
        // Dispo d'un AUTRE tour : ne compte pas pour celui-ci.
        { member_id: "baptiste", date: "2026-09-16T12:00:00+00:00" },
      ],
    });
    expect(r.expected).toBe(3);
    expect(r.declared).toBe(1);
    expect(r.missing).toEqual(["Baptiste LeBec", "Samy Kirat"]);
  });

  it("n'attend pas les membres jamais mobilisés, mais les signale à part", () => {
    const r = availabilityCoverage({ members, participantIds, range, availabilities: [] });
    expect(r.expected).toBe(3);
    expect(r.neverParticipated).toEqual(["Christine Lamaille"]);
  });

  it("bornes incluses", () => {
    const r = availabilityCoverage({
      members,
      participantIds,
      range,
      availabilities: [
        { member_id: "romain", date: "2026-09-25" },
        { member_id: "baptiste", date: "2026-10-02" },
        { member_id: "samy", date: "2026-10-03" },
      ],
    });
    expect(r.missing).toEqual(["Samy Kirat"]);
  });
});

describe("coverageWarning", () => {
  it("se tait quand tout le monde a saisi ses dispos", () => {
    expect(
      coverageWarning(
        { expected: 3, declared: 3, missing: [], neverParticipated: [] },
        "le Tour 2",
      ),
    ).toBeNull();
  });

  it("nomme les absents et le pourcentage", () => {
    const msg = coverageWarning(
      {
        expected: 21,
        declared: 19,
        missing: ["Baptiste LeBec", "Samy Kirat"],
        neverParticipated: ["Christine Lamaille"],
      },
      "le Tour 2",
    )!;
    expect(msg).toContain("19 examinateurs sur 21 (90 %)");
    expect(msg).toContain("Baptiste LeBec, Samy Kirat");
    expect(msg).toContain("Christine Lamaille");
    expect(msg).toContain("Publier quand même ?");
  });
});
