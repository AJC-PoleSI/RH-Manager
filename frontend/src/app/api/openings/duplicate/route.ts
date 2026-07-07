import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";
import {
  sliceOpeningRow,
  slotInsertRow,
  checkOpeningOverlap,
} from "@/lib/openings-service";

export const dynamic = "force-dynamic";

// POST /api/openings/duplicate — admin : copie les ouvertures d'une date
// vers une ou plusieurs autres dates (créneaux générés dans la foulée).
// Les copies qui créeraient un chevauchement de salle sont ignorées et
// remontées en avertissement.
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const { epreuveId, sourceDate, targetDates } = await req.json();

    if (
      !epreuveId ||
      !sourceDate ||
      !Array.isArray(targetDates) ||
      targetDates.length === 0
    ) {
      return Response.json(
        { error: "epreuveId, sourceDate et targetDates requis" },
        { status: 400 },
      );
    }

    const { data: epreuve, error: epErr } = await supabaseAdmin
      .from("epreuves")
      .select("*")
      .eq("id", epreuveId)
      .single();
    if (epErr || !epreuve) {
      return Response.json({ error: "Épreuve introuvable" }, { status: 404 });
    }

    const { data: sources, error: srcErr } = await supabaseAdmin
      .from("room_openings")
      .select("*")
      .eq("epreuve_id", epreuveId)
      .eq("date", sourceDate);
    if (srcErr) throw srcErr;

    if (!sources || sources.length === 0) {
      return Response.json(
        { error: `Aucune ouverture à copier le ${sourceDate}` },
        { status: 400 },
      );
    }

    let createdOpenings = 0;
    let createdSlots = 0;
    const warnings: string[] = [];

    for (const targetDate of targetDates) {
      if (targetDate === sourceDate) {
        warnings.push(`${targetDate} : ignorée (identique à la source)`);
        continue;
      }
      for (const src of sources) {
        const startTime = String(src.start_time).slice(0, 5);
        const endTime = String(src.end_time).slice(0, 5);
        const overlapError = await checkOpeningOverlap(
          targetDate,
          src.room,
          startTime,
          endTime,
        );
        if (overlapError) {
          warnings.push(
            `${src.room} le ${targetDate} : ignorée (chevauchement)`,
          );
          continue;
        }

        const openingInput = {
          epreuve_id: epreuveId,
          room: src.room,
          date: targetDate,
          start_time: startTime,
          end_time: endTime,
          break_start: src.break_start,
          break_end: src.break_end,
        };
        const { data: opening, error: insertErr } = await supabaseAdmin
          .from("room_openings")
          .insert(openingInput)
          .select("*")
          .single();
        if (insertErr) throw insertErr;

        const target = sliceOpeningRow(openingInput, epreuve);
        const rows = target.map((t) =>
          slotInsertRow(t, targetDate, src.room, epreuve, opening.id),
        );
        if (rows.length > 0) {
          const { error: slotsErr } = await supabaseAdmin
            .from("evaluation_slots")
            .insert(rows);
          if (slotsErr) {
            await supabaseAdmin
              .from("room_openings")
              .delete()
              .eq("id", opening.id);
            throw slotsErr;
          }
        }
        createdOpenings++;
        createdSlots += rows.length;
      }
    }

    return Response.json({
      created_openings: createdOpenings,
      created_slots: createdSlots,
      warnings,
    });
  } catch (error) {
    console.error("Duplicate openings error:", error);
    return Response.json(
      { error: "Échec de duplication", details: String(error) },
      { status: 500 },
    );
  }
}
