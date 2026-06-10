import { supabaseAdmin } from "@/lib/supabase";

export interface NotificationInput {
  type?: string;
  title: string;
  body?: string;
  link?: string;
}

/**
 * Crée une notification in-app pour chaque membre listé.
 * Fail-soft : en cas d'erreur (table absente, etc.), log + retourne 0
 * pour ne jamais bloquer le flux appelant.
 */
export async function notifyMembers(
  memberIds: string[],
  notif: NotificationInput,
): Promise<number> {
  const ids = Array.from(new Set(memberIds.filter(Boolean)));
  if (ids.length === 0) return 0;

  const rows = ids.map((memberId) => ({
    member_id: memberId,
    type: notif.type || "info",
    title: notif.title,
    body: notif.body || null,
    link: notif.link || null,
  }));

  const { error } = await supabaseAdmin.from("notifications").insert(rows);
  if (error) {
    console.error("notifyMembers error:", error);
    return 0;
  }
  return rows.length;
}
