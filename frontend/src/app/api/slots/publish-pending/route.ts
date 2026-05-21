import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";

// POST /api/slots/publish-pending — publie les créneaux non encore publiés
// (status "draft" ou "open" ou "ready") d'une épreuve en "published".
//
// IMPORTANT : ne touche PAS aux créneaux déjà "published" ni à leurs inscriptions.
// Les candidats déjà inscrits restent inscrits — leur créneau ne bouge pas.
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const { epreuveId } = await req.json();

    if (!epreuveId) {
      return Response.json({ error: "epreuveId requis" }, { status: 400 });
    }

    // Trouver tous les créneaux non publiés pour cette épreuve
    const { data: pending, error: fetchErr } = await supabaseAdmin
      .from("evaluation_slots")
      .select("id, status")
      .eq("epreuve_id", epreuveId)
      .in("status", ["draft", "open", "ready"]);

    if (fetchErr) throw fetchErr;

    const ids = (pending || []).map((s: any) => s.id);

    if (ids.length === 0) {
      return Response.json({
        message: "Aucun nouveau créneau à publier",
        published: 0,
      });
    }

    // Passer en "published" — les inscriptions existantes (sur d'autres créneaux
    // déjà publiés) ne sont PAS touchées car on filtre sur status non-published
    const { data: updated, error: updErr } = await supabaseAdmin
      .from("evaluation_slots")
      .update({ status: "published" })
      .in("id", ids)
      .select("id");

    if (updErr) throw updErr;

    // Activer aussi la visibilité du planning si pas déjà fait
    await supabaseAdmin.from("system_settings").upsert(
      [
        { key: "planning_visible_candidats", value: "true" },
        { key: "planning_generated", value: "true" },
      ],
      { onConflict: "key" },
    );

    return Response.json({
      message: `${updated?.length || 0} créneau(x) publié(s) aux candidats`,
      published: updated?.length || 0,
    });
  } catch (error) {
    console.error("Publish pending slots error:", error);
    return Response.json(
      { error: "Échec publication", details: String(error) },
      { status: 500 },
    );
  }
}
