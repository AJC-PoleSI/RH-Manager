import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { runDispatch } from "@/lib/dispatchService";
import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";

/** Vrai si l'erreur signifie « la colonne availabilities.epreuve_id n'existe pas ». */
function isMissingEpreuveColumn(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  const code = String(e.code ?? "");
  // PostgREST: PGRST204 = colonne absente du cache de schéma.
  // Postgres:  42703    = undefined_column.
  if (code === "PGRST204" || code === "42703") return true;
  return String(e.message ?? "")
    .toLowerCase()
    .includes("epreuve_id");
}

/**
 * Insère les disponibilités d'un membre.
 *
 * `epreuve_id` mémorise l'épreuve pour laquelle le créneau a été coché : c'est
 * ce qui permet au dispatch de ne PAS embarquer l'examinateur sur une épreuve
 * voisine dont l'horaire ne coïncide que partiellement (cf.
 * availabilityMatchesSlot). Tant que la migration n'est pas appliquée, on
 * retombe sur des dispos purement horaires — comportement d'avant.
 */
async function insertAvailabilities(memberId: string, list: any[]) {
  if (!list || list.length === 0) return;

  // FIX H4: normalize to UTC noon so YYYY-MM-DD matching in
  // auto-allocate (substring 0..10) stays day-stable across TZs.
  const base = list.map((a: any) => ({
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

  const withEpreuve = base.map((row, i) => ({
    ...row,
    epreuve_id: list[i]?.epreuveId || null,
  }));

  const { error } = await supabaseAdmin
    .from("availabilities")
    .insert(withEpreuve);
  if (!error) return;
  if (!isMissingEpreuveColumn(error)) throw error;

  console.warn(
    "[availability] Colonne availabilities.epreuve_id absente — dispos " +
      "enregistrées sans l'épreuve. Appliquez la section « dispos par " +
      "épreuve » de MIGRATIONS_A_APPLIQUER.sql.",
  );
  const { error: fallbackError } = await supabaseAdmin
    .from("availabilities")
    .insert(base);
  if (fallbackError) throw fallbackError;
}

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
    // CHEVAUCHEMENTS AUTORISÉS (changement métier, sept. 2026)
    //
    // Un examinateur PEUT désormais se déclarer disponible sur deux créneaux
    // qui se chevauchent — typiquement deux épreuves au même moment. Se
    // déclarer disponible n'est pas s'engager : c'est au DISPATCH de trancher
    // (il place l'examinateur sur le créneau le plus en tension et le laisse en
    // liste d'attente sur l'autre — cf. dispatchService.ts, étapes 9d/10bis).
    // Le double-booking réel reste impossible : `wouldConflict` interdit au
    // dispatch d'affecter un membre à deux créneaux qui se chevauchent.
    //
    // L'ancienne garde « anti-chevauchement » refusait TOUTE la sauvegarde dès
    // que deux blocs cochés se recoupaient partiellement (ex. 14h–15h et
    // 14h30–15h30), ce qui empêchait précisément ce choix.
    //
    // Reste la déduplication stricte : une même épreuve au même horaire ne doit
    // pas produire deux lignes identiques.
    // ══════════════════════════════════════════════════════════════════
    const dedupedAvailabilities = (() => {
      if (!availabilities || availabilities.length === 0) return [];
      const seen = new Set<string>();
      return availabilities.filter((a: any) => {
        const key = [
          String(a.date || a.weekday || ""),
          a.startTime,
          a.endTime,
          a.epreuveId || "",
        ].join("|");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    })();

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

      await insertAvailabilities(memberId, dedupedAvailabilities);
    } else {
      // Overwrite all mode: delete all member's availabilities, then create
      const { error: deleteError } = await supabaseAdmin
        .from("availabilities")
        .delete()
        .eq("member_id", memberId);

      if (deleteError) throw deleteError;

      await insertAvailabilities(memberId, dedupedAvailabilities);
    }

    // Re-run the intelligent dispatch (équité + brassage anti-binôme) so the
    // assignments stay in sync with the member's new availabilities. We use
    // runDispatch — not the legacy runAutoAllocate — so that a full global
    // re-balancing happens over ALL current availabilities at every save
    // (titulaires rotate across slots instead of freezing the first two
    // members who declared).
    //
    // L'erreur reste avalée — la disponibilité, elle, EST enregistrée, et
    // annuler la requête ferait croire au membre qu'il n'a rien sauvegardé.
    // En revanche elle n'est plus muette : l'admin est notifié. Sans ça, un
    // recalcul qui échoue n'existe que dans les logs Vercel et le planning
    // reste figé sans que personne ne s'en aperçoive — c'est exactement ce
    // qui a masqué le bug de pagination diagnostiqué le 11/09/2026.
    try {
      await runDispatch();
    } catch (e) {
      console.error("Dispatch after availability change failed:", e);
      try {
        await notifyAdmins({
          type: "dispatch_failed",
          title: "⚠️ Le recalcul du planning a échoué",
          body:
            "Les disponibilités ont bien été enregistrées, mais la répartition " +
            "automatique des examinateurs n'a pas pu être recalculée. Le planning " +
            "est peut-être désynchronisé — relancez « Recalculer tout » depuis la " +
            `page planning. Détail : ${String(e).substring(0, 200)}`,
          link: "/dashboard/planning",
        });
      } catch (notifyError) {
        console.error("notifyAdmins after dispatch failure:", notifyError);
      }
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
    // Note : la saisie des dispos est désormais TOUJOURS ouverte (cf. PUT).
    // Les examinateurs peuvent s'inscrire/se désinscrire à tout moment jusqu'à
    // l'épreuve. L'ancien verrou "saisie_dispos_ouverte" n'est plus appliqué
    // ici non plus, pour rester cohérent avec la grille (PUT).

    const { weekday, start_time, end_time } = await req.json();

    // ── Doublon strict uniquement ──
    // Les chevauchements sont AUTORISÉS depuis sept. 2026 (cf. PUT) : un
    // examinateur peut se déclarer disponible sur deux épreuves qui se
    // recoupent, c'est le dispatch qui tranche. On refuse seulement la même
    // plage à l'identique, qui n'apporterait rien.
    const { data: existing } = await supabaseAdmin
      .from("availabilities")
      .select("start_time, end_time")
      .eq("member_id", memberId)
      .eq("weekday", weekday);

    const isDuplicate = (existing || []).some(
      (ex: any) =>
        String(ex.start_time).substring(0, 5) ===
          String(start_time).substring(0, 5) &&
        String(ex.end_time).substring(0, 5) ===
          String(end_time).substring(0, 5),
    );

    if (isDuplicate) {
      return Response.json(
        {
          error: `Disponibilité déjà enregistrée le ${weekday} : ${start_time}-${end_time}.`,
        },
        { status: 400 },
      );
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
