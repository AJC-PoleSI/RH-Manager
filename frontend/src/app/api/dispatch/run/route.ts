import { runDispatch } from "@/lib/dispatchService";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/dispatch/run
 *
 * Triggers the intelligent dispatch algorithm.
 *
 * Déclencheurs :
 *   - Admin clique "Publier" (avec epreuveId dans le body)
 *   - Membre sauvegarde ses disponibilités (sans epreuveId = global)
 *   - Appel API explicite
 *
 * Body (optionnel) :
 *   { epreuveId?: string }  — limiter le dispatch à une épreuve spécifique
 *
 * Réponse :
 *   { updated, backupsAssigned, unfilled, frozen, notifications }
 */
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  try {
    const body = await req.json().catch(() => ({}));
    const result = await runDispatch({
      epreuveId: body.epreuveId || undefined,
    });

    return Response.json({
      success: true,
      ...result,
      message: `Dispatch terminé : ${result.updated} affectation(s), ${result.backupsAssigned} remplaçant(s), ${result.frozen} créneau(x) gelé(s), ${result.notifications} notification(s).`,
    });
  } catch (error) {
    console.error("dispatch/run error:", error);
    return Response.json(
      { error: "Le dispatch a échoué", details: String(error) },
      { status: 500 },
    );
  }
}
