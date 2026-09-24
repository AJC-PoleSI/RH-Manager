import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { extractTourNumber } from "@/lib/tour-archive";
import { refusedBeforeTourFilter } from "@/lib/elimination";
import { NextRequest } from "next/server";

// GET /api/tours - Fetch all tours with candidate count
export async function GET(req: NextRequest) {
  // SECURITY (audit #11): require auth. Les candidats ont besoin de connaître
  // le tour actif (pour débloquer le classement des vœux au Tour 2), donc ils
  // peuvent lire les noms/statuts des tours déjà commencés — mais JAMAIS le
  // nombre de candidats (candidateCount masqué à 0 pour eux), NI les tours
  // pas encore commencés (statut "a_venir", cf. visibilité tours 2026-09-07) :
  // un candidat ne doit pas savoir combien de tours il reste après le sien.
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  const isPrivileged = payload.role !== "candidate" || payload.isAdmin;
  try {
    const { data: tours, error } = await supabaseAdmin
      .from("tours")
      .select("id, name, status")
      .order("name", { ascending: true });

    if (error) throw error;

    // Compte des candidats réservé aux membres/admins : ceux qui participent
    // (ou ont participé) à chaque tour commencé, c.-à-d. tous les inscrits
    // moins les refusés des tours précédents (73 au tour 1, 10 refusés → 63
    // au tour 2). Un tour « à venir » reste à 0 : ses participants dépendent
    // de délibérations pas encore faites.
    const countByTourId = new Map<string, number>();
    const startedTours = isPrivileged
      ? (tours || []).filter((t: any) => t.status !== "a_venir")
      : [];
    if (startedTours.length > 0) {
      const { count: total } = await supabaseAdmin
        .from("candidates")
        .select("id", { count: "exact", head: true });
      await Promise.all(
        startedTours.map(async (t: any) => {
          const eliminated = await countRefusedBefore(
            extractTourNumber(t.name),
          );
          countByTourId.set(t.id, Math.max(0, (total || 0) - eliminated));
        }),
      );
    }

    const visibleTours = isPrivileged
      ? tours || []
      : (tours || []).filter((t: any) => t.status !== "a_venir");

    const result = visibleTours.map((t: any) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      candidateCount: countByTourId.get(t.id) ?? 0,
    }));

    return Response.json(result);
  } catch (error) {
    console.error("Tours GET error:", error);
    return Response.json({ error: "Failed to fetch tours" }, { status: 500 });
  }
}

// Candidats refusés à un tour antérieur à `tour` (une délibération par
// candidat, cf. deliberations/[candidateId]).
async function countRefusedBefore(tour: number): Promise<number> {
  const filter = refusedBeforeTourFilter(tour);
  if (!filter) return 0;
  const { count, error } = await supabaseAdmin
    .from("deliberations")
    .select("candidate_id", { count: "exact", head: true })
    .or(filter);
  if (error) throw error;
  return count || 0;
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
