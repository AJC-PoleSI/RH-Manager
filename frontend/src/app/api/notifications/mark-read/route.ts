import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { NextRequest } from "next/server";

// POST /api/notifications/mark-read
// Body: { ids?: string[] } — marque les notifications listées comme lues,
// ou TOUTES les non-lues de l'utilisateur (membre OU candidat) si ids est
// absent. Le filtre par propriétaire vient du jeton, jamais du corps.
export async function POST(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();

  const isCandidate = user.role === "candidate";
  const table = isCandidate ? "candidate_notifications" : "notifications";
  const ownerColumn = isCandidate ? "candidate_id" : "member_id";

  try {
    const body = await req.json().catch(() => ({}));
    const ids: string[] | undefined = Array.isArray(body?.ids)
      ? body.ids
      : undefined;

    let query = supabaseAdmin
      .from(table)
      .update({ read_at: new Date().toISOString() })
      .eq(ownerColumn, user.id)
      .is("read_at", null);

    if (ids && ids.length > 0) {
      query = query.in("id", ids);
    }

    const { error } = await query;
    if (error) throw error;

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Notifications mark-read error:", error);
    return Response.json(
      { error: "Erreur lors du marquage des notifications" },
      { status: 500 },
    );
  }
}
