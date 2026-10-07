import type { TokenPayload } from "@/lib/auth";

// ════════════════════════════════════════════════════════════════════════════
// Autorisations d'écriture du calendrier (POST /api/calendar, PUT et DELETE
// /api/calendar/[id]) — source unique, testée dans calendar-access.test.ts.
//
// SECURITY (audit du 07/10/2026) : POST ne bloquait que les événements
// globaux. Un compte CANDIDAT pouvait créer un événement non global rattaché
// à n'importe quel membre, candidat ou épreuve, avec les identifiants pris
// tels quels dans le corps de la requête — et l'événement apparaissait dans
// le calendrier de la personne visée.
//
// Modèle (déjà appliqué à PUT/DELETE depuis l'audit du 19/08/2026) :
//   • candidat         → lecture seule : ne crée, ne modifie, ne supprime rien.
//   • admin            → tout : événements globaux, rattachement à n'importe
//                        quel membre, candidat ou épreuve.
//   • membre non-admin → uniquement SES événements : jamais global, toujours
//                        rattaché à lui-même (l'id vient du jeton, jamais du
//                        corps), jamais à un candidat ni à un autre membre.
// ════════════════════════════════════════════════════════════════════════════

export type CalendarCaller = Pick<TokenPayload, "id" | "role" | "isAdmin">;

export const CALENDAR_DENIED = {
  candidate: "Les candidats ne peuvent pas modifier le calendrier.",
  global: "Seul un administrateur peut gérer un événement global.",
  otherMember: "Vous ne pouvez créer un événement que dans votre propre calendrier.",
  candidateLink: "Seul un administrateur peut rattacher un événement à un candidat.",
  notOwner: "Vous ne pouvez modifier que vos propres événements.",
} as const;

export type CalendarDenied = { ok: false; error: string };

export interface CalendarEventLinks {
  is_global: boolean;
  related_epreuve_id: string | null;
  related_member_id: string | null;
  related_candidate_id: string | null;
}

/** Ligne minimale d'un événement existant pour décider d'une écriture. */
export interface ExistingCalendarEvent {
  is_global: boolean | null;
  related_member_id: string | null;
}

/** Un identifiant n'est retenu que s'il est une chaîne non vide. */
function idOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

/**
 * Création : décide si l'appelant peut créer l'événement demandé et calcule
 * ses rattachements. Pour un membre non-admin, le rattachement au membre
 * est imposé depuis le jeton ; toute demande visant quelqu'un d'autre est
 * refusée explicitement plutôt que réécrite en silence.
 */
export function resolveNewEventLinks(
  caller: CalendarCaller,
  rawBody: unknown,
): { ok: true; links: CalendarEventLinks } | CalendarDenied {
  if (caller.role !== "member") {
    return { ok: false, error: CALENDAR_DENIED.candidate };
  }

  const body = asRecord(rawBody);
  const isGlobal = body.is_global === true || body.type === "global";
  const epreuveId = idOrNull(body.related_epreuve_id);
  const memberId = idOrNull(body.related_member_id);
  const candidateId = idOrNull(body.related_candidate_id);

  if (caller.isAdmin) {
    return {
      ok: true,
      links: isGlobal
        ? {
            is_global: true,
            related_epreuve_id: null,
            related_member_id: null,
            related_candidate_id: null,
          }
        : {
            is_global: false,
            related_epreuve_id: epreuveId,
            related_member_id: memberId,
            related_candidate_id: candidateId,
          },
    };
  }

  if (isGlobal) return { ok: false, error: CALENDAR_DENIED.global };
  if (memberId !== null && memberId !== caller.id) {
    return { ok: false, error: CALENDAR_DENIED.otherMember };
  }
  if (candidateId !== null) {
    return { ok: false, error: CALENDAR_DENIED.candidateLink };
  }

  return {
    ok: true,
    links: {
      is_global: false,
      // L'épreuve n'est pas une identité : la rattacher à son propre
      // événement ne montre rien à personne d'autre (la clé étrangère
      // rejette un id inexistant).
      related_epreuve_id: epreuveId,
      related_member_id: caller.id,
      related_candidate_id: null,
    },
  };
}

/** Modification / suppression d'un événement existant. */
export function canEditCalendarEvent(
  caller: CalendarCaller,
  existing: ExistingCalendarEvent,
): { ok: true } | CalendarDenied {
  if (caller.role !== "member") {
    return { ok: false, error: CALENDAR_DENIED.candidate };
  }
  if (caller.isAdmin) return { ok: true };
  // Un événement global n'appartient à personne : réservé aux admins.
  if (existing.is_global) return { ok: false, error: CALENDAR_DENIED.global };
  if (existing.related_member_id !== caller.id) {
    return { ok: false, error: CALENDAR_DENIED.notOwner };
  }
  return { ok: true };
}

/**
 * Champs de rattachement qu'une modification peut changer : seul un admin
 * réattribue un événement à un autre membre/candidat — sinon un membre s'en
 * débarrasserait ou le collerait dans le calendrier de quelqu'un d'autre.
 */
export function reassignmentFields(
  caller: CalendarCaller,
  rawBody: unknown,
): Partial<Pick<CalendarEventLinks, "related_member_id" | "related_candidate_id">> {
  if (caller.role !== "member" || !caller.isAdmin) return {};
  const body = asRecord(rawBody);
  const fields: Partial<
    Pick<CalendarEventLinks, "related_member_id" | "related_candidate_id">
  > = {};
  if (body.related_member_id !== undefined) {
    fields.related_member_id = idOrNull(body.related_member_id);
  }
  if (body.related_candidate_id !== undefined) {
    fields.related_candidate_id = idOrNull(body.related_candidate_id);
  }
  return fields;
}
