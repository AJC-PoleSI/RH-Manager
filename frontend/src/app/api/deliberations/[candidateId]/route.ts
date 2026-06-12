import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { isTourLocked } from "@/lib/tour-status";
import { NextRequest } from "next/server";

// GET /api/deliberations/[candidateId]
// SECURITY: Requires auth + admin/member role
export async function GET(
  req: NextRequest,
  { params }: { params: { candidateId: string } },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (payload.role === "candidate") return forbidden();

  const { candidateId } = params;

  try {
    const { data: deliberation, error } = await supabaseAdmin
      .from("deliberations")
      .select("*")
      .eq("candidate_id", candidateId)
      .maybeSingle();

    if (error) throw error;

    return Response.json(deliberation || { status: "No deliberation yet" });
  } catch (error) {
    return Response.json(
      { error: "Failed to fetch deliberation" },
      { status: 500 },
    );
  }
}

// 423 Locked : le tour est verrouillé, décision non modifiable.
function tourLockedResponse(tour: number) {
  return Response.json(
    {
      error: `Le Tour ${tour} est verrouillé. Réouvrez-le pour modifier les décisions.`,
      locked: true,
      tour,
    },
    { status: 423 },
  );
}

// PUT /api/deliberations/[candidateId]
// SECURITY: Requires auth + admin only
export async function PUT(
  req: NextRequest,
  { params }: { params: { candidateId: string } },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  const { candidateId } = params;

  try {
    const {
      tour1Status,
      tour2Status,
      tour3Status,
      globalComments,
      prosComment,
      consComment,
    } = await req.json();

    // Verrouillage : on ne peut plus toucher aux décisions d'un tour
    // "terminé". L'admin doit d'abord réouvrir le tour (POST /api/tours/reopen).
    if (tour1Status !== undefined && (await isTourLocked(1))) {
      return tourLockedResponse(1);
    }
    if (tour2Status !== undefined && (await isTourLocked(2))) {
      return tourLockedResponse(2);
    }
    if (tour3Status !== undefined && (await isTourLocked(3))) {
      return tourLockedResponse(3);
    }

    const updateData: Record<string, unknown> = {};
    if (tour1Status !== undefined) updateData.tour1_status = tour1Status;
    if (tour2Status !== undefined) updateData.tour2_status = tour2Status;
    if (tour3Status !== undefined) updateData.tour3_status = tour3Status;
    if (globalComments !== undefined)
      updateData.global_comments = globalComments;
    if (prosComment !== undefined) updateData.pros_comment = prosComment;
    if (consComment !== undefined) updateData.cons_comment = consComment;

    const { data: existing } = await supabaseAdmin
      .from("deliberations")
      .select("id")
      .eq("candidate_id", candidateId)
      .maybeSingle();

    let deliberation;

    if (existing) {
      const { data, error } = await supabaseAdmin
        .from("deliberations")
        .update(updateData)
        .eq("candidate_id", candidateId)
        .select()
        .single();

      if (error) throw error;
      deliberation = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from("deliberations")
        .insert({ candidate_id: candidateId, ...updateData })
        .select()
        .single();

      if (error) throw error;
      deliberation = data;
    }

    return Response.json(deliberation);
  } catch (error) {
    console.error("updateDeliberation error:", error);
    return Response.json(
      { error: "Failed to update deliberation" },
      { status: 400 },
    );
  }
}
