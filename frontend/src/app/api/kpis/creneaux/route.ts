import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/kpis/creneaux — par épreuve : créneaux "ready" et candidats inscrits.
// Réservé aux admins, même périmètre que /api/kpis/global.
//
// Nommée "creneaux" et non "slots" : les bloqueurs de pub (EasyList et
// dérivés) bloquent silencieusement toute requête dont le chemin contient
// "/slots" (règles anti-casino/machines à sous) — la requête n'atteignait
// jamais le serveur, sans la moindre erreur visible côté client.
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const { data: slots, error } = await supabaseAdmin
      .from("evaluation_slots")
      .select(
        "id, epreuve_id, status, epreuve:epreuves(id, name, tour), enrollments:slot_enrollments(id)",
      )
      .not("epreuve_id", "is", null);

    if (error) throw error;

    const byEpreuve: Record<
      string,
      {
        epreuveId: string;
        name: string;
        tour: number | null;
        totalSlots: number;
        readySlots: number;
        candidatsInscrits: number;
      }
    > = {};

    (slots || []).forEach((s: any) => {
      const key = s.epreuve_id;
      if (!byEpreuve[key]) {
        byEpreuve[key] = {
          epreuveId: key,
          name: s.epreuve?.name ?? "Épreuve supprimée",
          tour: s.epreuve?.tour ?? null,
          totalSlots: 0,
          readySlots: 0,
          candidatsInscrits: 0,
        };
      }
      const entry = byEpreuve[key];
      entry.totalSlots++;
      if (s.status === "ready") entry.readySlots++;
      entry.candidatsInscrits += s.enrollments?.length ?? 0;
    });

    const epreuves = Object.values(byEpreuve).sort(
      (a, b) => a.name.localeCompare(b.name) || (a.tour ?? 0) - (b.tour ?? 0),
    );

    const totals = epreuves.reduce(
      (acc, e) => ({
        totalSlots: acc.totalSlots + e.totalSlots,
        readySlots: acc.readySlots + e.readySlots,
        candidatsInscrits: acc.candidatsInscrits + e.candidatsInscrits,
      }),
      { totalSlots: 0, readySlots: 0, candidatsInscrits: 0 },
    );

    return Response.json({ epreuves, totals });
  } catch (error) {
    console.error("KPI slots error:", error);
    return Response.json(
      { error: "Failed to fetch slots KPIs" },
      { status: 500 },
    );
  }
}
