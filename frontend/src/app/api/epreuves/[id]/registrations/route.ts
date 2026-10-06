import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { samePole } from "@/lib/auth-poles";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/epreuves/[id]/registrations — inscrits d'une épreuve en distanciel
//
// Admins : toujours. Membre non admin : seulement sur une épreuve de SON pôle
// (les mêmes qui peuvent noter ces candidats, cf. lib/distanciel.ts).
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (user.role !== "member") return forbidden();

  try {
    const { data: epreuve, error: epErr } = await supabaseAdmin
      .from("epreuves")
      .select("id, is_distanciel, is_pole_test, pole")
      .eq("id", params.id)
      .maybeSingle();
    if (epErr) throw epErr;
    if (!epreuve) {
      return Response.json({ error: "Épreuve introuvable" }, { status: 404 });
    }

    if (!user.isAdmin) {
      const { data: me } = await supabaseAdmin
        .from("members")
        .select("pole")
        .eq("id", user.id)
        .maybeSingle();
      if (!epreuve.is_pole_test || !samePole(epreuve.pole, me?.pole)) {
        return forbidden();
      }
    }

    const { data, error } = await supabaseAdmin
      .from("epreuve_registrations")
      .select("created_at, candidate:candidates(id, first_name, last_name, email)")
      .eq("epreuve_id", params.id)
      .order("created_at", { ascending: true });
    if (error) throw error;

    const registrations = (data || [])
      .filter((r: any) => r.candidate)
      .map((r: any) => ({
        candidateId: r.candidate.id,
        firstName: r.candidate.first_name || "",
        lastName: r.candidate.last_name || "",
        email: r.candidate.email || "",
        registeredAt: r.created_at,
      }));

    return Response.json({
      isDistanciel: epreuve.is_distanciel === true,
      count: registrations.length,
      registrations,
    });
  } catch (error) {
    console.error("GET /epreuves/[id]/registrations error:", error);
    return Response.json(
      { error: "Impossible de charger les inscrits." },
      { status: 500 },
    );
  }
}
