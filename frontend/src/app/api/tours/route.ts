import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";

// GET /api/tours - Fetch all tours with candidate count
export async function GET() {
  try {
    const { data: tours, error } = await supabaseAdmin
      .from("tours")
      .select("*")
      .order("name", { ascending: true });

    if (error) throw error;

    // Get candidate count (total candidates in system)
    const { count: totalCandidates } = await supabaseAdmin
      .from("candidates")
      .select("id", { count: "exact", head: true });

    const result = (tours || []).map((t: any) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      candidateCount: t.status === "en_cours" ? totalCandidates || 0 : 0,
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
