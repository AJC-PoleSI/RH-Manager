import { supabaseAdmin, isMissingTableError } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { notifyMembers } from "@/lib/notifications";
import {
  normalizeSlotLinkLabel,
  normalizeSlotLinkUrl,
  slotLinkErrorMessage,
  slotLinkHost,
} from "@/lib/slot-links";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const MIGRATION_PENDING =
  "Les liens de business game ne sont pas encore actifs en base. Appliquez la migration supabase-migration-bg-links.sql.";

/** Créneau + son jury, tels qu'il faut les connaître pour poser un lien. */
async function loadSlotForLink(id: string) {
  const { data } = await supabaseAdmin
    .from("evaluation_slots")
    .select(
      `id, date, start_time, end_time, room,
       epreuve:epreuves(id, name, is_group_epreuve),
       members:slot_member_assignments(member_id)`,
    )
    .eq("id", id)
    .single();
  return data as any;
}

/** « lundi 15 septembre, 14:00 – 15:30 (salle 204) » */
function slotLabel(slot: any): string {
  const date = slot?.date
    ? new Date(slot.date).toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : "";
  const start = String(slot?.start_time || "").substring(0, 5);
  const end = String(slot?.end_time || "").substring(0, 5);
  const room = slot?.room ? ` (salle ${slot.room})` : "";
  return `${date}, ${start} – ${end}${room}`;
}

/**
 * PUT /api/slots/[id]/link — poser ou remplacer le lien d'un créneau (admin).
 *
 * Body : { url: string, label?: string, notify?: boolean }
 *
 * RÉSERVÉ AUX ÉPREUVES DE GROUPE : le lien est une ressource de business game,
 * partagée par le jury d'un groupe. Le refuser ailleurs n'est pas une coquetterie
 * — c'est ce qui garantit qu'aucun créneau d'entretien individuel ne porte un
 * lien que les écrans candidats n'ont jamais été écrits pour cacher.
 *
 * Les examinateurs affectés sont prévenus (notification in-app), sauf
 * `notify: false` — corriger une faute de frappe dans une URL ne mérite pas
 * une seconde notification.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  const { id } = await params;

  try {
    const body = await req.json().catch(() => ({}));

    const slot = await loadSlotForLink(id);
    if (!slot) {
      return Response.json({ error: "Créneau introuvable" }, { status: 404 });
    }
    if (slot.epreuve?.is_group_epreuve !== true) {
      return Response.json(
        {
          error: "Le lien est réservé aux épreuves de groupe (business game).",
        },
        { status: 400 },
      );
    }

    const normalized = normalizeSlotLinkUrl(body.url);
    if (!normalized.ok) {
      return Response.json(
        { error: slotLinkErrorMessage(normalized.error) },
        { status: 400 },
      );
    }
    const label = normalizeSlotLinkLabel(body.label);

    // Le lien existait-il déjà ? Change le message envoyé au jury : « un lien
    // a été ajouté » et « le lien a changé » n'appellent pas le même réflexe.
    const { data: before } = await supabaseAdmin
      .from("slot_links")
      .select("url")
      .eq("slot_id", id)
      .maybeSingle();

    const row = {
      slot_id: id,
      url: normalized.url,
      label,
      updated_by: payload.id,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabaseAdmin
      .from("slot_links")
      .upsert(row, { onConflict: "slot_id" });

    if (error) {
      if (isMissingTableError(error)) {
        return Response.json({ error: MIGRATION_PENDING }, { status: 503 });
      }
      throw error;
    }

    // ── Prévenir le jury du créneau, et lui seul ──
    let notified = 0;
    const changed = !before || before.url !== normalized.url;
    if (body.notify !== false && changed) {
      const memberIds = (slot.members || [])
        .map((m: any) => m.member_id)
        .filter(Boolean);
      notified = await notifyMembers(memberIds, {
        type: "slot_link",
        title: before ? "🔗 Lien de votre BG modifié" : "🔗 Lien de votre BG",
        body: `${slot.epreuve?.name || "Business game"} — ${slotLabel(slot)} : ${
          label || slotLinkHost(normalized.url) || "lien disponible"
        }. Retrouvez-le dans votre planning.`,
        link: "/dashboard/planning",
      });
    }

    return Response.json({
      success: true,
      link: { url: normalized.url, label, updatedAt: row.updated_at },
      _notified: notified,
    });
  } catch (error) {
    console.error("slot link PUT error:", error);
    return Response.json(
      { error: "Échec de l'enregistrement du lien" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/slots/[id]/link — retirer le lien d'un créneau (admin).
 *
 * Sans notification : retirer un lien posé par erreur ne doit pas remplir la
 * cloche des examinateurs. Le lien disparaît simplement de leur planning.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  const { id } = await params;

  try {
    const { error } = await supabaseAdmin
      .from("slot_links")
      .delete()
      .eq("slot_id", id);

    if (error) {
      if (isMissingTableError(error)) {
        return Response.json({ error: MIGRATION_PENDING }, { status: 503 });
      }
      throw error;
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error("slot link DELETE error:", error);
    return Response.json(
      { error: "Échec de la suppression du lien" },
      { status: 500 },
    );
  }
}
