import { describe, it, expect } from "vitest";
import {
  CALENDAR_DENIED,
  canEditCalendarEvent,
  reassignmentFields,
  resolveNewEventLinks,
  type CalendarCaller,
} from "./calendar-access";

const ADMIN: CalendarCaller = { id: "admin-1", role: "member", isAdmin: true };
const MEMBER: CalendarCaller = { id: "member-1", role: "member", isAdmin: false };
const CANDIDATE: CalendarCaller = { id: "cand-1", role: "candidate" };

// Audit du 07/10/2026 : POST /api/calendar ne bloquait que les événements
// globaux. Un compte CANDIDAT pouvait créer un événement rattaché à
// n'importe quel membre, candidat ou épreuve, avec les identifiants pris
// tels quels dans le corps de la requête.
describe("resolveNewEventLinks — création d'un événement", () => {
  it("refuse toute création à un candidat, même rattachée à lui-même", () => {
    for (const body of [
      {},
      { related_candidate_id: CANDIDATE.id },
      { related_member_id: "member-2", related_candidate_id: "cand-2" },
      { related_epreuve_id: "ep-1" },
      { is_global: true },
    ]) {
      const verdict = resolveNewEventLinks(CANDIDATE, body);
      expect(verdict).toEqual({ ok: false, error: CALENDAR_DENIED.candidate });
    }
  });

  it("admin : un événement global n'est rattaché à rien", () => {
    for (const body of [
      { is_global: true, related_member_id: "m", related_candidate_id: "c", related_epreuve_id: "e" },
      { type: "global", related_member_id: "m" },
    ]) {
      expect(resolveNewEventLinks(ADMIN, body)).toEqual({
        ok: true,
        links: {
          is_global: true,
          related_epreuve_id: null,
          related_member_id: null,
          related_candidate_id: null,
        },
      });
    }
  });

  it("admin : peut rattacher un événement à n'importe quel membre, candidat ou épreuve", () => {
    expect(
      resolveNewEventLinks(ADMIN, {
        related_member_id: "member-2",
        related_candidate_id: "cand-2",
        related_epreuve_id: "ep-1",
      }),
    ).toEqual({
      ok: true,
      links: {
        is_global: false,
        related_epreuve_id: "ep-1",
        related_member_id: "member-2",
        related_candidate_id: "cand-2",
      },
    });
  });

  it("membre : refuse un événement global", () => {
    expect(resolveNewEventLinks(MEMBER, { is_global: true })).toEqual({
      ok: false,
      error: CALENDAR_DENIED.global,
    });
    expect(resolveNewEventLinks(MEMBER, { type: "global" })).toEqual({
      ok: false,
      error: CALENDAR_DENIED.global,
    });
  });

  it("membre : l'événement est toujours le sien, l'id vient du jeton", () => {
    for (const body of [{}, { related_member_id: MEMBER.id }, { related_member_id: "" }]) {
      expect(resolveNewEventLinks(MEMBER, body)).toEqual({
        ok: true,
        links: {
          is_global: false,
          related_epreuve_id: null,
          related_member_id: MEMBER.id,
          related_candidate_id: null,
        },
      });
    }
  });

  it("membre : refuse de rattacher l'événement à un autre membre", () => {
    expect(resolveNewEventLinks(MEMBER, { related_member_id: "member-2" })).toEqual({
      ok: false,
      error: CALENDAR_DENIED.otherMember,
    });
  });

  it("membre : refuse de rattacher l'événement à un candidat", () => {
    expect(resolveNewEventLinks(MEMBER, { related_candidate_id: "cand-2" })).toEqual({
      ok: false,
      error: CALENDAR_DENIED.candidateLink,
    });
  });

  it("membre : peut associer son événement à une épreuve", () => {
    expect(resolveNewEventLinks(MEMBER, { related_epreuve_id: "ep-1" })).toEqual({
      ok: true,
      links: {
        is_global: false,
        related_epreuve_id: "ep-1",
        related_member_id: MEMBER.id,
        related_candidate_id: null,
      },
    });
  });

  it("ignore les identifiants qui ne sont pas des chaînes non vides", () => {
    expect(
      resolveNewEventLinks(ADMIN, {
        related_member_id: 42,
        related_candidate_id: "   ",
        related_epreuve_id: { id: "ep-1" },
      }),
    ).toEqual({
      ok: true,
      links: {
        is_global: false,
        related_epreuve_id: null,
        related_member_id: null,
        related_candidate_id: null,
      },
    });
  });

  it("un corps absent ou non-objet ne rattache rien", () => {
    expect(resolveNewEventLinks(MEMBER, null)).toEqual({
      ok: true,
      links: {
        is_global: false,
        related_epreuve_id: null,
        related_member_id: MEMBER.id,
        related_candidate_id: null,
      },
    });
  });
});

describe("canEditCalendarEvent — modification / suppression", () => {
  const own = { is_global: false, related_member_id: MEMBER.id };

  it("refuse tout candidat", () => {
    expect(canEditCalendarEvent(CANDIDATE, own)).toEqual({
      ok: false,
      error: CALENDAR_DENIED.candidate,
    });
  });

  it("admin : tout événement, global compris", () => {
    expect(canEditCalendarEvent(ADMIN, { is_global: true, related_member_id: null })).toEqual({ ok: true });
    expect(canEditCalendarEvent(ADMIN, { is_global: false, related_member_id: "member-2" })).toEqual({ ok: true });
  });

  it("membre : uniquement ses propres événements", () => {
    expect(canEditCalendarEvent(MEMBER, own)).toEqual({ ok: true });
    expect(canEditCalendarEvent(MEMBER, { is_global: false, related_member_id: "member-2" })).toEqual({
      ok: false,
      error: CALENDAR_DENIED.notOwner,
    });
    // Événement orphelin : il n'appartient à personne.
    expect(canEditCalendarEvent(MEMBER, { is_global: false, related_member_id: null })).toEqual({
      ok: false,
      error: CALENDAR_DENIED.notOwner,
    });
  });

  it("membre : jamais un événement global", () => {
    expect(canEditCalendarEvent(MEMBER, { is_global: true, related_member_id: MEMBER.id })).toEqual({
      ok: false,
      error: CALENDAR_DENIED.global,
    });
  });
});

describe("reassignmentFields — réattribution lors d'une modification", () => {
  const body = { related_member_id: "member-2", related_candidate_id: "cand-2" };

  it("admin : peut réattribuer, y compris détacher (null)", () => {
    expect(reassignmentFields(ADMIN, body)).toEqual(body);
    expect(reassignmentFields(ADMIN, { related_candidate_id: null })).toEqual({
      related_candidate_id: null,
    });
    expect(reassignmentFields(ADMIN, {})).toEqual({});
  });

  it("membre : la réattribution est ignorée", () => {
    expect(reassignmentFields(MEMBER, body)).toEqual({});
  });
});
