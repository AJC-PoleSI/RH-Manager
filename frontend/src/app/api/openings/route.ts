import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";
import { diffOpeningSlots } from "@/lib/opening-slicer";
import {
  sliceOpeningRow,
  slotInsertRow,
  checkOpeningOverlap,
  isSlotOccupied,
  validateOpeningInput,
} from "@/lib/openings-service";

export const dynamic = "force-dynamic";

// GET /api/openings?epreuveId= — admin : liste les ouvertures d'une épreuve
// avec décomptes (créneaux total / occupés) et conflits (occupés hors du
// découpage courant, recalculé à la volée).
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  const epreuveId = req.nextUrl.searchParams.get("epreuveId");
  if (!epreuveId) {
    return Response.json({ error: "epreuveId requis" }, { status: 400 });
  }

  try {
    const { data: epreuve, error: epErr } = await supabaseAdmin
      .from("epreuves")
      .select("*")
      .eq("id", epreuveId)
      .single();
    if (epErr || !epreuve) {
      return Response.json({ error: "Épreuve introuvable" }, { status: 404 });
    }

    const { data: openings, error } = await supabaseAdmin
      .from("room_openings")
      .select(
        `*, slots:evaluation_slots(id, date, start_time, end_time, room, status,
          members:slot_member_assignments(id),
          enrollments:slot_enrollments(id, status, candidate_id))`,
      )
      .eq("epreuve_id", epreuveId)
      .order("date", { ascending: true })
      .order("room", { ascending: true });

    if (error) throw error;

    const result = ((openings as any[]) || []).map((o) => {
      const slots = (o.slots || []).map((s: any) => ({
        id: s.id,
        date: String(s.date).split("T")[0],
        start_time: String(s.start_time).slice(0, 5),
        end_time: String(s.end_time).slice(0, 5),
        room: s.room,
        status: s.status,
        occupied: isSlotOccupied(s),
      }));
      const target = sliceOpeningRow(o, epreuve);
      const diff = diffOpeningSlots(String(o.date).split("T")[0], target, slots);
      const conflictSet = new Set(diff.conflictIds);
      return {
        id: o.id,
        epreuve_id: o.epreuve_id,
        room: o.room,
        date: String(o.date).split("T")[0],
        start_time: String(o.start_time).slice(0, 5),
        end_time: String(o.end_time).slice(0, 5),
        break_start: o.break_start ? String(o.break_start).slice(0, 5) : null,
        break_end: o.break_end ? String(o.break_end).slice(0, 5) : null,
        slots_total: slots.length,
        slots_occupied: slots.filter((s: any) => s.occupied).length,
        conflicts: slots.filter((s: any) => conflictSet.has(s.id)),
      };
    });

    return Response.json(result);
  } catch (error) {
    console.error("List openings error:", error);
    return Response.json(
      { error: "Échec du chargement des ouvertures", details: String(error) },
      { status: 500 },
    );
  }
}

// POST /api/openings — admin : crée une ouverture ET ses créneaux découpés.
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const body = await req.json();
    const { epreuveId, room, date, startTime, endTime, breakStart, breakEnd } =
      body;

    if (!epreuveId) {
      return Response.json({ error: "epreuveId requis" }, { status: 400 });
    }

    const openingInput = {
      room: String(room || "").trim(),
      date,
      start_time: startTime,
      end_time: endTime,
      break_start: breakStart || null,
      break_end: breakEnd || null,
    };
    const validationError = validateOpeningInput(openingInput);
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 });
    }

    const { data: epreuve, error: epErr } = await supabaseAdmin
      .from("epreuves")
      .select("*")
      .eq("id", epreuveId)
      .single();
    if (epErr || !epreuve) {
      return Response.json({ error: "Épreuve introuvable" }, { status: 404 });
    }

    const target = sliceOpeningRow(openingInput, epreuve);
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

    const overlapError = await checkOpeningOverlap(
      date,
      openingInput.room,
      startTime,
      endTime,
    );
    if (overlapError) {
      return Response.json({ error: overlapError }, { status: 409 });
    }

    const { data: opening, error: insertErr } = await supabaseAdmin
      .from("room_openings")
      .insert({ epreuve_id: epreuveId, ...openingInput })
      .select("*")
      .single();
    if (insertErr) throw insertErr;

    const rows = target.map((t) =>
      slotInsertRow(t, date, openingInput.room, epreuve, opening.id),
    );
    const { error: slotsErr } = await supabaseAdmin
      .from("evaluation_slots")
      .insert(rows);

    if (slotsErr) {
      // Compensation : ne pas laisser une ouverture sans créneaux
      await supabaseAdmin.from("room_openings").delete().eq("id", opening.id);
      throw slotsErr;
    }

    return Response.json(
      { opening, slots_created: rows.length },
      { status: 201 },
    );
  } catch (error) {
    console.error("Create opening error:", error);
    return Response.json(
      { error: "Échec de création de l'ouverture", details: String(error) },
      { status: 500 },
    );
  }
}
