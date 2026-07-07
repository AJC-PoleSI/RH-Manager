import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";
import { diffOpeningSlots } from "@/lib/opening-slicer";
import {
  sliceOpeningRow,
  slotInsertRow,
  checkOpeningOverlap,
  fetchOpeningSlots,
  notifySlotDeletion,
  deleteSlotsByIds,
  validateOpeningInput,
} from "@/lib/openings-service";

export const dynamic = "force-dynamic";

// PUT /api/openings/[id] — admin : modifie une ouverture et recalcule ses
// créneaux. Règles : libres recréés selon la nouvelle plage, occupés jamais
// touchés, occupés hors plage signalés en conflit (spec §3).
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  const { id } = await params;

  try {
    const body = await req.json();

    const { data: current, error: curErr } = await supabaseAdmin
      .from("room_openings")
      .select("*")
      .eq("id", id)
      .single();
    if (curErr || !current) {
      return Response.json({ error: "Ouverture introuvable" }, { status: 404 });
    }

    // Fusion champs partiels
    const next = {
      room: String(body.room ?? current.room).trim(),
      date: String(body.date ?? current.date).split("T")[0],
      start_time: String(body.startTime ?? current.start_time).slice(0, 5),
      end_time: String(body.endTime ?? current.end_time).slice(0, 5),
      break_start:
        body.breakStart !== undefined
          ? body.breakStart || null
          : current.break_start,
      break_end:
        body.breakEnd !== undefined ? body.breakEnd || null : current.break_end,
    };

    const validationError = validateOpeningInput(next);
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 });
    }

    const { data: epreuve, error: epErr } = await supabaseAdmin
      .from("epreuves")
      .select("*")
      .eq("id", current.epreuve_id)
      .single();
    if (epErr || !epreuve) {
      return Response.json({ error: "Épreuve introuvable" }, { status: 404 });
    }

    const target = sliceOpeningRow(next, epreuve);
    if (target.length === 0) {
      const dur = epreuve.duration_minutes || 30;
      const roul = epreuve.roulement_minutes ?? 10;
      return Response.json(
        {
          error: `La plage est trop courte pour un seul créneau (durée ${dur} min + roulement ${roul} min).`,
        },
        { status: 400 },
      );
    }

    const existing = await fetchOpeningSlots(id);

    // Anti-chevauchement contre les créneaux des AUTRES ouvertures/épreuves
    const overlapError = await checkOpeningOverlap(
      next.date,
      next.room,
      next.start_time,
      next.end_time,
      existing.map((s) => s.id),
    );
    if (overlapError) {
      return Response.json({ error: overlapError }, { status: 409 });
    }

    const diff = diffOpeningSlots(next.date, target, existing);

    // 1. Supprimer les créneaux libres hors cible (aucune inscription → pas de notification)
    await deleteSlotsByIds(diff.toDeleteIds);

    // 2. Créer les nouveaux horaires
    if (diff.toCreate.length > 0) {
      const rows = diff.toCreate.map((t) =>
        slotInsertRow(t, next.date, next.room, epreuve, id),
      );
      const { error: insertErr } = await supabaseAdmin
        .from("evaluation_slots")
        .insert(rows);
      if (insertErr) throw insertErr;
    }

    // 3. Mettre à jour la salle des créneaux conservés si elle a changé
    if (next.room !== current.room && diff.keptIds.length > 0) {
      await supabaseAdmin
        .from("evaluation_slots")
        .update({ room: next.room })
        .in("id", diff.keptIds);
    }

    // 4. Mettre à jour l'ouverture elle-même
    const { data: opening, error: updErr } = await supabaseAdmin
      .from("room_openings")
      .update(next)
      .eq("id", id)
      .select("*")
      .single();
    if (updErr) throw updErr;

    const conflictSet = new Set(diff.conflictIds);
    const conflicts = existing
      .filter((s) => conflictSet.has(s.id))
      .map((s) => ({
        id: s.id,
        date: s.date,
        start_time: s.start_time,
        end_time: s.end_time,
        room: (s.raw && s.raw.room) || next.room,
      }));

    return Response.json({
      opening,
      created: diff.toCreate.length,
      deleted: diff.toDeleteIds.length,
      kept: diff.keptIds.length,
      conflicts,
    });
  } catch (error) {
    console.error("Update opening error:", error);
    return Response.json(
      { error: "Échec de modification de l'ouverture", details: String(error) },
      { status: 500 },
    );
  }
}

// DELETE /api/openings/[id] — admin : supprime l'ouverture et ses créneaux
// libres. S'il reste des occupés : 409 sauf ?force=true (suppression +
// notification des inscrits, comme le reset).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  const { id } = await params;
  const force = req.nextUrl.searchParams.get("force") === "true";

  try {
    const { data: current, error: curErr } = await supabaseAdmin
      .from("room_openings")
      .select("*")
      .eq("id", id)
      .single();
    if (curErr || !current) {
      return Response.json({ error: "Ouverture introuvable" }, { status: 404 });
    }

    const existing = await fetchOpeningSlots(id);
    const occupied = existing.filter((s) => s.occupied);
    const free = existing.filter((s) => !s.occupied);

    if (occupied.length > 0 && !force) {
      return Response.json(
        {
          error: "Des créneaux de cette ouverture ont des inscrits",
          occupied: occupied.map((s) => ({
            id: s.id,
            date: s.date,
            start_time: s.start_time,
            end_time: s.end_time,
          })),
        },
        { status: 409 },
      );
    }

    let notified = 0;
    if (force && occupied.length > 0) {
      notified = await notifySlotDeletion(occupied.map((s) => s.raw));
      await deleteSlotsByIds(existing.map((s) => s.id));
    } else {
      await deleteSlotsByIds(free.map((s) => s.id));
    }

    const { error: delErr } = await supabaseAdmin
      .from("room_openings")
      .delete()
      .eq("id", id);
    if (delErr) throw delErr;

    return Response.json({
      success: true,
      deleted_slots: force ? existing.length : free.length,
      notified_candidates: notified,
    });
  } catch (error) {
    console.error("Delete opening error:", error);
    return Response.json(
      { error: "Échec de suppression de l'ouverture", details: String(error) },
      { status: 500 },
    );
  }
}
