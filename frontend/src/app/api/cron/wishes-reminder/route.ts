import { NextRequest, NextResponse } from "next/server";
import { runWishesReminder } from "@/lib/wishes-reminder-db";

// ════════════════════════════════════════════════════════════════════
// CRON — relance des vœux de pôle (cf. frontend/vercel.json → crons, 8 h)
//
// Vercel appelle cette route avec `Authorization: Bearer ${CRON_SECRET}`
// dès que la variable existe sur le projet. Sans elle, on REFUSE (503) :
// une route d'envoi de mails ouverte à tous ferait un bel outil de spam.
//
// force-dynamic est indispensable : sans ça, Next.js pré-rend la route au
// build et Vercel sert la réponse depuis son cache sans jamais exécuter
// l'envoi (même piège que /api/health, cf. mémoire keep-alive).
// ════════════════════════════════════════════════════════════════════
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const noStore = { "Cache-Control": "no-store, max-age=0" };

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/wishes-reminder] CRON_SECRET non configuré — aucun envoi");
    return NextResponse.json(
      { error: "CRON_SECRET non configuré" },
      { status: 503, headers: noStore },
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json(
      { error: "Non autorise" },
      { status: 401, headers: noStore },
    );
  }

  try {
    const result = await runWishesReminder({ dryRun: false });
    if (result.migrationPending) {
      console.error(
        "[cron/wishes-reminder] colonne candidates.wishes_reminded_at absente — " +
          "appliquer supabase-migration-wishes-reminder.sql ; aucun envoi.",
      );
    }
    return NextResponse.json(result, { headers: noStore });
  } catch (e) {
    console.error("[cron/wishes-reminder] échec:", e);
    return NextResponse.json(
      { error: "Échec de la relance des vœux" },
      { status: 500, headers: noStore },
    );
  }
}
