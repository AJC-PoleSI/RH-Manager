import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import {
  CALENDAR_DENIED,
  canEditCalendarEvent,
  reassignmentFields,
  type CalendarCaller,
} from "@/lib/calendar-access";
import { NextRequest } from "next/server";

// ════════════════════════════════════════════════════════════════════════════
// SECURITY (audit du 19/08/2026, point #11) : PUT et DELETE ne vérifiaient
// que la présence d'un token — ni le rôle, ni la propriété de l'événement.
// N'importe quel compte authentifié, CANDIDAT COMPRIS, pouvait modifier ou
// supprimer n'importe quel événement du calendrier via son id.
//
// Modèle appliqué, partagé avec POST /api/calendar (lib/calendar-access.ts) :
//   • candidat            → lecture seule (403)
//   • admin               → tout
//   • membre non-admin    → uniquement SES événements (related_member_id),
//                           jamais les événements globaux, et sans pouvoir
//                           réattribuer l'événement à quelqu'un d'autre.
// ════════════════════════════════════════════════════════════════════════════

function denied(error: string) {
  return Response.json({ error }, { status: 403 });
}

interface Guarded {
  caller: CalendarCaller;
}

/**
 * Charge l'événement et vérifie que l'appelant a le droit de l'écrire.
 * Retourne une Response en cas de refus, sinon le contexte autorisé.
 */
async function authorizeWrite(
  req: NextRequest,
  id: string,
): Promise<Response | Guarded> {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  // Les candidats ne créent jamais d'événement : ils n'en modifient aucun.
  // Refus avant toute lecture en base.
  if (payload.role !== "member") return denied(CALENDAR_DENIED.candidate);

  if (payload.isAdmin) return { caller: payload };

  const { data: existing, error } = await supabaseAdmin
    .from("calendar_events")
    .select("id, is_global, related_member_id")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("calendar authorize error:", error);
    return Response.json(
      { error: "Service temporairement indisponible." },
      { status: 503 },
    );
  }
  if (!existing) {
    return Response.json({ error: "Événement introuvable" }, { status: 404 });
  }
  const verdict = canEditCalendarEvent(payload, existing);
  if (!verdict.ok) return denied(verdict.error);

  return { caller: payload };
}

// PUT /api/calendar/[id] — update a calendar event
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const auth = await authorizeWrite(req, id);
  if (auth instanceof Response) return auth;

  try {
    const body = await req.json();
    const {
      title,
      description,
      day,
      day_end,
      start_time,
      end_time,
      startTime,
      endTime,
      visible_to_candidates,
      color,
      related_epreuve_id,
    } = body;

    const data: Record<string, any> = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (day !== undefined) data.day = new Date(day).toISOString();
    if (day_end !== undefined) data.day_end = day_end ? new Date(day_end).toISOString() : null;
    if (start_time || startTime) data.start_time = start_time || startTime;
    if (end_time || endTime) data.end_time = end_time || endTime;
    if (visible_to_candidates !== undefined) data.visible_to_candidates = visible_to_candidates;
    if (color !== undefined) data.color = color;
    if (related_epreuve_id !== undefined)
      data.related_epreuve_id = related_epreuve_id;
    // SECURITY : seul un admin peut réattribuer un événement à un autre
    // membre/candidat (ignoré pour un membre non-admin).
    Object.assign(data, reassignmentFields(auth.caller, body));

    const { data: event, error } = await supabaseAdmin
      .from("calendar_events")
      .update(data)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return Response.json(event);
  } catch (error) {
    console.error("Update event error details:", error);
    return Response.json({ error: "Failed to update event" }, { status: 400 });
  }
}

// DELETE /api/calendar/[id] — delete a calendar event
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const auth = await authorizeWrite(req, id);
  if (auth instanceof Response) return auth;

  try {
    const { error } = await supabaseAdmin
      .from("calendar_events")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json({ error: "Failed to delete event" }, { status: 400 });
  }
}
