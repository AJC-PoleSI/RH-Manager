import { NextRequest } from "next/server";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { runWishesReminder } from "@/lib/wishes-reminder-db";

export const dynamic = "force-dynamic";

// POST /api/admin/wishes-reminder — admin uniquement.
// Body: { dryRun?: boolean }
//
// Même fonction que le cron du matin : `dryRun: true` n'écrit rien et
// renvoie les compteurs (c'est l'aperçu de la carte « Relance des vœux ») ;
// `dryRun: false` est le bouton « Envoyer la relance maintenant » — et le
// chemin du tout premier envoi, sur feu vert explicite de Felix.
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const raw = await req.json().catch(() => ({}));
    const dryRun = raw?.dryRun === true;
    const result = await runWishesReminder({ dryRun });
    return Response.json(result);
  } catch (e) {
    console.error("Admin wishes-reminder error:", e);
    return Response.json(
      { error: "Échec de la relance des vœux" },
      { status: 500 },
    );
  }
}
