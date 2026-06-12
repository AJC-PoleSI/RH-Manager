import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";

// GET /api/tours - Fetch all tours with candidate count
export async function GET(req: NextRequest) {
  // SECURITY (audit #11): require auth. Les candidats ont besoin de connaître
  // le tour actif (pour débloquer le classement des vœux au Tour 2), donc ils
  // peuvent lire les noms/statuts des tours — mais JAMAIS le nombre de
  // candidats (candidateCount masqué à 0 pour eux).
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  const isPrivileged = payload.role !== "candidate" || payload.isAdmin;
  try {
    const { data: tours, error } = await supabaseAdmin
      .from("tours")
      .select("id, name, status")
      .order("name", { ascending: true });

    if (error) throw error;

    // Compte des candidats réservé aux membres/admins.
    let totalCandidates = 0;
    if (isPrivileged) {
      const { count } = await supabaseAdmin
        .from("candidates")
        .select("id", { count: "exact", head: true });
      totalCandidates = count || 0;
    }

    const result = (tours || []).map((t: any) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      candidateCount:
        isPrivileged && t.status === "en_cours" ? totalCandidates : 0,
    }));

    return Response.json(result);
  } catch (error) {
    console.error("Tours GET error:", error);
    return Response.json({ error: "Failed to fetch tours" }, { status: 500 });
  }
}

// POST /api/tours - Create a new tour (admin only)
export async function POST(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  try {
    const { name, status } = await req.json();

    if (!name) {
      return Response.json({ error: "Name is required" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("tours")
      .insert({
        name,
        status: status || "a_venir",
      })
      .select()
      .single();

    if (error) throw error;

    return Response.json(
      {
        id: data.id,
        name: data.name,
        status: data.status,
        candidateCount: 0,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Tours POST error:", error);
    return Response.json({ error: "Failed to create tour" }, { status: 500 });
  }
}
