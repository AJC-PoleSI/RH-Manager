import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { runDispatch } from "@/lib/dispatchService";
import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";

// GET /api/availability — get my availabilities (with optional ?start=&end= date filters)
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const memberId = payload.id;
  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  try {
    let query = supabaseAdmin
      .from("availabilities")
      .select("*")
      .eq("member_id", memberId);

    if (start && end) {
      const startDate = new Date(start);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(end);
      endDate.setHours(23, 59, 59, 999);

      query = query
        .gte("date", startDate.toISOString())
        .lte("date", endDate.toISOString());
    }

    const { data, error } = await query;
    if (error) throw error;

    // FIX C4: no-store
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    return Response.json(
      { error: "Failed to fetch availabilities" },
      { status: 500 },
    );
  }
}

// PUT /api/availability — bulk replace availabilities
export async function PUT(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  // SECURITY (audit #17): availabilities are a member feature only.
  if (payload.role !== "member") {
    return Response.json({ error: "Accès interdit" }, { status: 403 });
  }

  const memberId = payload.id;

  try {
    // Note : la saisie est désormais toujours ouverte côté front (les examinateurs
    // peuvent s'inscrire et se désinscrire à tout moment jusqu'à l'épreuve).
    // L'ancien verrou "saisie_dispos_ouverte" n'est plus appliqué.

    const { availabilities, startDate, endDate } = await req.json();

    // ══════════════════════════════════════════════════════════════════
    // GARDE 1 : Anti-chevauchement (overlapping) strict
    // Un membre ne peut pas avoir deux disponibilités qui se chevauchent
    // sur la même journée (même weekday OU même date).
    // On compare les plages horaires réelles, pas juste la clé startTime.
    // ══════════════════════════════════════════════════════════════════
    if (availabilities && availabilities.length > 0) {
      // Convertit "09h00" ou "09:00" en minutes depuis minuit
      const toMinutes = (t: string): number => {
        const clean = t.replace("h", ":").replace(/[^0-9:]/g, "");
        const [h, m] = clean.split(":").map(Number);
        return (h || 0) * 60 + (m || 0);
      };

      for (let i = 0; i < availabilities.length; i++) {
        for (let j = i + 1; j < availabilities.length; j++) {
          const a = availabilities[i];
          const b = availabilities[j];

          // Même jour ? (par weekday ou par date)
          const sameDay =
            (a.weekday && b.weekday && a.weekday === b.weekday) ||
            (a.date && b.date && a.date === b.date);

          if (!sameDay) continue;

          // Vérification chevauchement : [startA, endA[ ∩ [startB, endB[ ≠ ∅
          const startA = toMinutes(a.startTime);
          const endA = toMinutes(a.endTime);
          const startB = toMinutes(b.startTime);
          const endB = toMinutes(b.endTime);

          if (startA < endB && startB < endA) {
            const dayLabel = a.weekday || a.date || "";
            return Response.json(
              {
                error: `Chevauchement detecte le ${dayLabel} : ${a.startTime}-${a.endTime} et ${b.startTime}-${b.endTime}. Un membre ne peut pas etre a deux endroits en meme temps.`,
              },
              { status: 400 },
            );
          }
        }
      }
    }

    if (startDate && endDate) {
      // Date-specific mode: delete only in this range, then create
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      const { error: deleteError } = await supabaseAdmin
        .from("availabilities")
        .delete()
        .eq("member_id", memberId)
        .gte("date", start.toISOString())
        .lte("date", end.toISOString());

      if (deleteError) throw deleteError;

      if (availabilities && availabilities.length > 0) {
        // FIX H4: normalize to UTC noon so YYYY-MM-DD matching in
        // auto-allocate (substring 0..10) stays day-stable across TZs.
        const rows = availabilities.map((a: any) => ({
          member_id: memberId,
          weekday: a.weekday,
          date: a.date
            ? new Date(
                String(a.date).substring(0, 10) + "T12:00:00.000Z",
              ).toISOString()
            : null,
          start_time: a.startTime,
          end_time: a.endTime,
        }));

        const { error: insertError } = await supabaseAdmin
          .from("availabilities")
          .insert(rows);

        if (insertError) throw insertError;
      }
    } else {
      // Overwrite all mode: delete all member's availabilities, then create
      const { error: deleteError } = await supabaseAdmin
        .from("availabilities")
        .delete()
        .eq("member_id", memberId);

      if (deleteError) throw deleteError;

      if (availabilities && availabilities.length > 0) {
        // FIX H4: same TZ-stable normalization (see above).
        const rows = availabilities.map((a: any) => ({
          member_id: memberId,
          weekday: a.weekday,
          date: a.date
            ? new Date(
                String(a.date).substring(0, 10) + "T12:00:00.000Z",
              ).toISOString()
            : null,
          start_time: a.startTime,
          end_time: a.endTime,
        }));

        const { error: insertError } = await supabaseAdmin
          .from("availabilities")
          .insert(rows);

        if (insertError) throw insertError;
      }
    }

    // Re-run the intelligent dispatch (équité + brassage anti-binôme) so the
    // assignments stay in sync with the member's new availabilities. We use
    // runDispatch — not the legacy runAutoAllocate — so that a full global
    // re-balancing happens over ALL current availabilities at every save
    // (titulaires rotate across slots instead of freezing the first two
    // members who declared). Errors are swallowed because the availability
    // save itself succeeded.
    try {
      await runDispatch();
    } catch (e) {
      console.error("Dispatch after availability change failed:", e);
    }

    return Response.json({ message: "Availabilities updated" });
  } catch (error) {
    console.error("Replace Availabilities Error:", error);
    return Response.json(
      { error: "Failed to replace availabilities", details: String(error) },
      { status: 400 },
    );
  }
}

// POST /api/availability — add a single availability
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  // SECURITY: same as PUT — members only.
  if (payload.role !== "member") {
    return Response.json({ error: "Accès interdit" }, { status: 403 });
  }

  const memberId = payload.id;

  try {
    // ── Vérifier que la saisie est ouverte ──
    if (!payload.isAdmin) {
      const { data: settings } = await supabaseAdmin
        .from("system_settings")
        .select("value")
        .eq("key", "saisie_dispos_ouverte")
        .single();

      if (!settings || settings.value !== "true") {
        return Response.json(
          {
            error:
              "La saisie des disponibilites est fermee. Contactez l'administrateur.",
          },
          { status: 403 },
        );
      }
    }

    const { weekday, start_time, end_time } = await req.json();

    // ── Anti-chevauchement avec les dispos existantes en base ──
    const { data: existing } = await supabaseAdmin
      .from("availabilities")
      .select("*")
      .eq("member_id", memberId)
      .eq("weekday", weekday);

    if (existing && existing.length > 0) {
      const toMin = (t: string): number => {
        const clean = t.replace("h", ":").replace(/[^0-9:]/g, "");
        const [h, m] = clean.split(":").map(Number);
        return (h || 0) * 60 + (m || 0);
      };
      const newStart = toMin(start_time);
      const newEnd = toMin(end_time);

      for (const ex of existing) {
        const exStart = toMin(ex.start_time);
        const exEnd = toMin(ex.end_time);
        if (newStart < exEnd && exStart < newEnd) {
          return Response.json(
            {
              error: `Chevauchement detecte le ${weekday} : ${start_time}-${end_time} chevauche ${ex.start_time}-${ex.end_time}.`,
            },
            { status: 400 },
          );
        }
      }
    }

    const { data, error } = await supabaseAdmin
      .from("availabilities")
      .insert({
        member_id: memberId,
        weekday,
        start_time,
        end_time,
      })
      .select()
      .single();

    if (error) throw error;

    return Response.json(data, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: "Failed to add availability" },
      { status: 400 },
    );
  }
}
