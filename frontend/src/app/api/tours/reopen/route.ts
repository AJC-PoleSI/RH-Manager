import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { getToursByNumber } from "@/lib/tour-status";
import { NextRequest } from "next/server";

// POST /api/tours/reopen — Admin uniquement.
// Body: { tour: number }
//
// Échappatoire : réouvre un tour précédemment verrouillé (statut "en_cours")
// afin de corriger ponctuellement des décisions. Le tour suivant est remis
// "a_venir" pour rester cohérent (inverse exact de /api/tours/advance).
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const body = await req.json();
    const tour = Number(body.tour);

    if (!tour || tour < 1) {
      return Response.json({ error: "tour invalide" }, { status: 400 });
    }

    const tours = await getToursByNumber();
    const current = tours[tour];
    const next = tours[tour + 1];

    if (!current) {
      return Response.json(
        { error: `Tour ${tour} introuvable` },
        { status: 404 },
      );
    }

    const { error: openErr } = await supabaseAdmin
      .from("tours")
      .update({ status: "en_cours" })
      .eq("id", current.id);
    if (openErr) throw openErr;

    // Remettre le tour suivant en attente s'il avait été activé.
    if (next && next.status === "en_cours") {
      const { error: nextErr } = await supabaseAdmin
        .from("tours")
        .update({ status: "a_venir" })
        .eq("id", next.id);
      if (nextErr) throw nextErr;
    }

    return Response.json({ ok: true, reopened: tour });
  } catch (error) {
    console.error("POST tours/reopen error:", error);
    return Response.json(
      { error: "Échec de la réouverture du tour" },
      { status: 500 },
    );
  }
}
