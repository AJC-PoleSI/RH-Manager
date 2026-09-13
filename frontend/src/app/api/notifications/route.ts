import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/notifications — notifications de l'utilisateur connecté
// (30 dernières + compteur de non-lues).
//
// Membres et candidats ont leur propre table (`notifications` référence
// members(id)), mais la même forme de réponse : la cloche du header est le
// même composant pour les deux rôles.
export async function GET(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();

  const isCandidate = user.role === "candidate";
  const table = isCandidate ? "candidate_notifications" : "notifications";
  const ownerColumn = isCandidate ? "candidate_id" : "member_id";

  try {
    const [{ data, error }, { count: unreadCount, error: countError }] =
      await Promise.all([
        supabaseAdmin
          .from(table)
          .select("id, type, title, body, link, read_at, created_at")
          .eq(ownerColumn, user.id)
          .order("created_at", { ascending: false })
          .limit(30),
        supabaseAdmin
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq(ownerColumn, user.id)
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
