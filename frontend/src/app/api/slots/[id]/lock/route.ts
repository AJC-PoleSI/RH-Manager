import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { filterActiveEnrollments } from "@/lib/enrollment";
import {
  isMissingColumnError,
  lockPatch,
  unlockPatch,
} from "@/lib/slot-lock";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/slots/[id]/lock — figer / défiger un créneau (admin).
 *
 * Body : { locked: boolean, force?: boolean }
 *
 * FIGER  : le jury du créneau ne sera plus rebrassé par le dispatch, et son
 *          horaire / sa salle ne peuvent plus être modifiés sans `force`.
 *          Sert à sécuriser un créneau presque complet AVANT publication.
 *
 * DÉFIGER : demande `force: true` lorsque des candidats sont inscrits. Le
 *          client reçoit d'abord un 409 décrivant ce qu'il s'apprête à
 *          rouvrir — c'est la confirmation « Ce créneau a des candidats
 *          inscrits, êtes-vous sûr ? » côté UI.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  const { id } = await params;

  try {
    const body = await req.json().catch(() => ({}));
    const locked = body.locked !== false; // défaut : figer
    const force = body.force === true;

    const { data: slot, error: slotErr } = await supabaseAdmin
      .from("evaluation_slots")
      .select(
        "id, date, start_time, end_time, room, status, enrollments:slot_enrollments(id, status)",
      )
      .eq("id", id)
      .single();

    if (slotErr || !slot) {
      return Response.json({ error: "Créneau introuvable" }, { status: 404 });
    }

    const enrolled = (slot.enrollments || []).filter(filterActiveEnrollments)
      .length;

    // Déverrouiller un créneau où des candidats ont déjà pris rendez-vous les
    // expose à nouveau au rebrassage du jury : on exige une confirmation
    // explicite plutôt que de le faire en silence.
    if (!locked && enrolled > 0 && !force) {
      return Response.json(
        {
          error: "confirmation_requise",
          message: `Ce créneau a ${enrolled} candidat(s) inscrit(s). Le déverrouiller autorise l'algorithme à en changer les examinateurs. Confirmer ?`,
          enrolled,
        },
        { status: 409 },
      );
    }

    const { error: updErr } = await supabaseAdmin
      .from("evaluation_slots")
      .update(locked ? lockPatch("manuel") : unlockPatch())
      .eq("id", id);

    if (updErr) {
      if (isMissingColumnError(updErr)) {
        return Response.json(
          {
            error:
              "Le verrouillage n'est pas encore actif en base. Appliquez la migration supabase-migration-slot-lock.sql.",
          },
          { status: 503 },
        );
      }
      throw updErr;
    }

    return Response.json({
      success: true,
      is_locked: locked,
      locked_reason: locked ? "manuel" : null,
      message: locked ? "Créneau figé" : "Créneau déverrouillé",
    });
  } catch (error) {
    console.error("slot lock error:", error);
    return Response.json(
      { error: "Échec du verrouillage", details: String(error) },
      { status: 500 },
    );
  }
}
