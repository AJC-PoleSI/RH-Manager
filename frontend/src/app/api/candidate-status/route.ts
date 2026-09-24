import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { getEliminationTour, getRefusalMessage } from "@/lib/elimination-db";
import { NextRequest } from "next/server";

// GET /api/candidate-status — le candidat connecté est-il encore en lice ?
//
// Un candidat refusé garde l'accès à son compte, mais l'espace candidat lui
// montre le message de refus reçu par email à la place des créneaux. Ne
// renvoie que les données du candidat du jeton, jamais d'un autre.
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (payload.role !== "candidate") {
    return Response.json({ eliminated: false });
  }

  try {
    const tour = await getEliminationTour(payload.id);
    if (tour == null) {
      return Response.json({ eliminated: false });
    }

    const [message, { data: candidate }] = await Promise.all([
      getRefusalMessage(payload.id, tour),
      supabaseAdmin
        .from("candidates")
        .select("first_name")
        .eq("id", payload.id)
        .maybeSingle(),
    ]);

    return Response.json(
      {
        eliminated: true,
        tour,
        firstName: candidate?.first_name || "",
        message,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("GET candidate-status error:", error);
    return Response.json(
      { error: "Statut indisponible" },
      { status: 500 },
    );
  }
}
