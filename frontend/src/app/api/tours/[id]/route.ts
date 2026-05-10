import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

// DELETE /api/tours/[id] - Delete a tour (admin only)
export async function DELETE(req: NextRequest, context: RouteContext) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  const { id } = await context.params;

  try {
    const { error } = await supabaseAdmin.from("tours").delete().eq("id", id);

    if (error) {
      console.error("Tour DELETE error:", error);
      return Response.json(
        { error: "Échec de la suppression du tour." },
        { status: 400 },
      );
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Tour DELETE error:", error);
    return Response.json(
      { error: "Échec de la suppression du tour." },
      { status: 500 },
    );
  }
}
