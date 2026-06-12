import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { getToursByNumber } from "@/lib/tour-status";
import { NextRequest } from "next/server";

// POST /api/tours/advance — Admin uniquement.
// Body: { fromTour: number }
//
// Verrouille le tour `fromTour` (statut "termine") et active le tour suivant
// (statut "en_cours"). À partir de là, les décisions du tour verrouillé ne
// sont plus modifiables (voir lib/tour-status + deliberations PUT), et les
// candidats peuvent agir sur le tour suivant (ex. classer leurs vœux).
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const body = await req.json();
    const fromTour = Number(body.fromTour);

    if (!fromTour || fromTour < 1) {
      return Response.json({ error: "fromTour invalide" }, { status: 400 });
    }

    const tours = await getToursByNumber();
    const current = tours[fromTour];
    const next = tours[fromTour + 1];

    if (!current) {
      return Response.json(
        { error: `Tour ${fromTour} introuvable` },
        { status: 404 },
      );
    }

    // Verrouiller le tour courant.
    const { error: lockErr } = await supabaseAdmin
      .from("tours")
      .update({ status: "termine" })
      .eq("id", current.id);
    if (lockErr) throw lockErr;

    // Activer le tour suivant s'il existe.
    if (next) {
      const { error: nextErr } = await supabaseAdmin
        .from("tours")
        .update({ status: "en_cours" })
        .eq("id", next.id);
      if (nextErr) throw nextErr;
    }

    return Response.json({
      ok: true,
      locked: fromTour,
      activated: next ? fromTour + 1 : null,
    });
  } catch (error) {
    console.error("POST tours/advance error:", error);
    return Response.json(
      { error: "Échec du passage au tour suivant" },
      { status: 500 },
    );
  }
}
