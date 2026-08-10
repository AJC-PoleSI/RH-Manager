import { getSupabaseAdmin } from "@/lib/supabase"
import { NextResponse } from "next/server"

// ════════════════════════════════════════════════════════════════════
// KEEP-ALIVE SUPABASE (cf. frontend/vercel.json → crons)
//
// Cette route sert aussi de « ping » anti-mise-en-veille : sur le plan
// gratuit, un projet Supabase est mis en pause après ~7 jours sans
// activité, et TOUTES les requêtes échouent alors (erreur Cloudflare 521).
//
// ⚠️ force-dynamic est INDISPENSABLE : sans ça, Next.js pré-rend cette
// route au build et Vercel sert une réponse statique depuis le cache
// (x-vercel-cache: HIT). Le cron répondait donc « ok » sans jamais
// toucher la base — le keep-alive ne servait à rien.
// ════════════════════════════════════════════════════════════════════
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  const noStore = { "Cache-Control": "no-store, max-age=0" }

  try {
    const supabase = getSupabaseAdmin()
    const { error } = await supabase.from("candidates").select("id").limit(1)

    if (error) {
      console.error("[health] keep-alive Supabase KO:", error)
      return NextResponse.json(
        { status: "error", error: error.message },
        { status: 500, headers: noStore },
      )
    }

    return NextResponse.json(
      { status: "ok", timestamp: new Date().toISOString() },
      { headers: noStore },
    )
  } catch (e) {
    console.error("[health] keep-alive Supabase KO:", e)
    return NextResponse.json(
      { status: "error", error: String(e) },
      { status: 500, headers: noStore },
    )
  }
}
