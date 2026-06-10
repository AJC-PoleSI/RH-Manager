import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { NextRequest } from "next/server";

// POST /api/notifications/mark-read
// Body: { ids?: string[] } — marque les notifications listées comme lues,
// ou TOUTES les non-lues du membre si ids est absent.
export async function POST(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (user.role !== "member") {
    return Response.json({ error: "Accès interdit" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const ids: string[] | undefined = Array.isArray(body?.ids)
      ? body.ids
      : undefined;

    let query = supabaseAdmin
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("member_id", user.id)
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
