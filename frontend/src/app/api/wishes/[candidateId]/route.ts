import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { NextRequest } from "next/server";

// SECURITY (audit #6/#7): only the candidate themselves OR a member
// (incl. admin) can read/write a candidate's wishes. Another candidate
// must NEVER be able to read or alter someone else's wishes.
function authorizeWishesAccess(
  payload: { role: string; id: string; isAdmin?: boolean },
  candidateId: string,
): boolean {
  if (payload.role === "candidate") {
    return payload.id === candidateId;
  }
  if (payload.role === "member") {
    return true; // members can view/edit candidate wishes (jury workflow)
  }
  return !!payload.isAdmin;
}

// GET /api/wishes/[candidateId] — get candidate wishes
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const { candidateId } = await params;
  if (!authorizeWishesAccess(payload as any, candidateId)) {
    return Response.json({ error: "Accès interdit" }, { status: 403 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("candidate_wishes")
      .select("*")
      .eq("candidate_id", candidateId)
      .order("rank", { ascending: true });

    if (error) throw error;

    return Response.json(data);
  } catch (error) {
    return Response.json({ error: "Failed to fetch wishes" }, { status: 500 });
  }
}

// PUT /api/wishes/[candidateId] — replace all wishes for a candidate
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const { candidateId } = await params;
  // SECURITY (audit #6): IDOR fix — block cross-candidate writes.
  if (!authorizeWishesAccess(payload as any, candidateId)) {
    return Response.json({ error: "Accès interdit" }, { status: 403 });
  }

  try {
    const { wishes } = await req.json();

    if (!Array.isArray(wishes)) {
      return Response.json(
        { error: "wishes must be an array" },
        { status: 400 },
      );
    }

    // Delete existing wishes
    const { error: deleteError } = await supabaseAdmin
      .from("candidate_wishes")
      .delete()
      .eq("candidate_id", candidateId);

    if (deleteError) throw deleteError;

    // Insert new wishes
    if (wishes.length > 0) {
      const rows = wishes.map((w: { pole: string; rank: number }) => ({
        candidate_id: candidateId,
        pole: w.pole,
        rank: w.rank,
      }));

      const { error: insertError } = await supabaseAdmin
        .from("candidate_wishes")
        .insert(rows);

      if (insertError) throw insertError;
    }

    // Return updated wishes
    const { data: updated, error: fetchError } = await supabaseAdmin
      .from("candidate_wishes")
      .select("*")
      .eq("candidate_id", candidateId)
      .order("rank", { ascending: true });

    if (fetchError) throw fetchError;

    return Response.json(updated);
  } catch (error) {
    return Response.json({ error: "Failed to save wishes" }, { status: 500 });
  }
}
