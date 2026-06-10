import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/notifications — notifications du membre connecté
// (30 dernières + compteur de non-lues).
export async function GET(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (user.role !== "member") {
    return Response.json({ error: "Accès interdit" }, { status: 403 });
  }

  try {
    const [{ data, error }, { count: unreadCount, error: countError }] =
      await Promise.all([
        supabaseAdmin
          .from("notifications")
          .select("id, type, title, body, link, read_at, created_at")
          .eq("member_id", user.id)
          .order("created_at", { ascending: false })
          .limit(30),
        supabaseAdmin
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("member_id", user.id)
          .is("read_at", null),
      ]);

    if (error || countError) throw error || countError;

    return Response.json({
      unreadCount: unreadCount || 0,
      notifications: (data || []).map((n: any) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link,
        read: !!n.read_at,
        createdAt: n.created_at,
      })),
    });
  } catch (error) {
    console.error("Notifications GET error:", error);
    // Fail-soft : la table peut ne pas encore exister (migration).
    return Response.json({ unreadCount: 0, notifications: [] });
  }
}
