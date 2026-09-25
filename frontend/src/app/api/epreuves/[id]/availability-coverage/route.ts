import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { fetchAllRows } from "@/lib/supabase-paging";
import { availabilityCoverage } from "@/lib/availability-coverage";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const ymd = (v: unknown) => String(v || "").substring(0, 10);

// GET /api/epreuves/[id]/availability-coverage — admin : combien
// d'examinateurs ont saisi des dispos sur les jours du tour de cette épreuve.
//
// Alimente l'avertissement affiché avant de publier (la publication fige les
// jurys, cf. lib/availability-coverage.ts). Lecture seule.
//
// Les jours du tour vont du premier au dernier créneau de ses épreuves. Une
// épreuve sans tour renseigné est jugée seule.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const { data: epreuve, error: epErr } = await supabaseAdmin
      .from("epreuves")
      .select("id, tour")
      .eq("id", params.id)
      .single();
    if (epErr || !epreuve) {
      return Response.json({ error: "Épreuve introuvable" }, { status: 404 });
    }

    let epreuveIds = [epreuve.id as string];
    if (epreuve.tour) {
      const { data: sameTour, error } = await supabaseAdmin
        .from("epreuves")
        .select("id")
        .eq("tour", epreuve.tour);
      if (error) throw error;
      epreuveIds = (sameTour || []).map((e: any) => e.id);
    }

    const bound = (ascending: boolean) =>
      supabaseAdmin
        .from("evaluation_slots")
        .select("date")
        .in("epreuve_id", epreuveIds)
        .order("date", { ascending })
        .limit(1);
    const [firstRes, lastRes] = await Promise.all([bound(true), bound(false)]);
    if (firstRes.error) throw firstRes.error;
    if (lastRes.error) throw lastRes.error;
    const from = ymd(firstRes.data?.[0]?.date);
    const to = ymd(lastRes.data?.[0]?.date);
    if (!from || !to) {
      return Response.json({
        tour: epreuve.tour ?? null,
        range: null,
        expected: 0,
        declared: 0,
        missing: [],
        neverParticipated: [],
      });
    }

    // Paginé : ces tables dépassent le plafond PostgREST des 1000 lignes
    // (cf. supabase-paging.ts) — une lecture tronquée compterait à tort des
    // examinateurs comme « jamais mobilisés ».
    const [membersRes, rangeAvRes, allAvRes, assignRes] = await Promise.all([
      fetchAllRows<any>((f, t) =>
        supabaseAdmin
          .from("members")
          .select("id, first_name, last_name, email")
          .order("id")
          .range(f, t),
      ),
      fetchAllRows<any>((f, t) =>
        supabaseAdmin
          .from("availabilities")
          .select("member_id, date")
          .gte("date", `${from}T00:00:00Z`)
          .lte("date", `${to}T23:59:59Z`)
          .order("id")
          .range(f, t),
      ),
      fetchAllRows<any>((f, t) =>
        supabaseAdmin
          .from("availabilities")
          .select("member_id")
          .order("id")
          .range(f, t),
      ),
      fetchAllRows<any>((f, t) =>
        supabaseAdmin
          .from("slot_member_assignments")
          .select("member_id")
          .order("id")
          .range(f, t),
      ),
    ]);
    const readErr =
      membersRes.error || rangeAvRes.error || allAvRes.error || assignRes.error;
    if (readErr) throw readErr;

    const participantIds = new Set<string>();
    [...(allAvRes.data || []), ...(assignRes.data || [])].forEach((r: any) => {
      if (r.member_id) participantIds.add(r.member_id);
    });

    const members = (membersRes.data || []).map((m: any) => ({
      id: m.id as string,
      name:
        [m.first_name, m.last_name]
          .map((p: unknown) => String(p || "").trim())
          .filter(Boolean)
          .join(" ") || String(m.email || "Membre"),
    }));

    const result = availabilityCoverage({
      members,
      availabilities: rangeAvRes.data || [],
      participantIds,
      range: { from, to },
    });

    return Response.json({
      tour: epreuve.tour ?? null,
      range: { from, to },
      ...result,
    });
  } catch (error) {
    console.error("GET /epreuves/:id/availability-coverage:", error);
    return Response.json(
      { error: "Lecture des disponibilités impossible" },
      { status: 500 },
    );
  }
}
