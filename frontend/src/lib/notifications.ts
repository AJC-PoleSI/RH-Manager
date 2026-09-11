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

/**
 * Notifie TOUS les membres (examinateurs et admins).
 *
 * Utilisé par le dispatch pour l'appel aux volontaires quand un créneau à
 * candidats tombe en sous-effectif : n'importe quel examinateur peut se
 * déclarer disponible, on ne sait pas à l'avance lequel pourra.
 *
 * Fail-soft comme `notifyMembers` : la lecture des membres qui échoue renvoie
 * 0 sans jamais interrompre l'appelant.
 */
export async function notifyAllMembers(
  notif: NotificationInput,
): Promise<number> {
  const { data, error } = await supabaseAdmin.from("members").select("id");
  if (error) {
    console.error("notifyAllMembers (lecture des membres) error:", error);
    return 0;
  }
  return notifyMembers(
    (data || []).map((m: { id: string }) => m.id),
    notif,
  );
}

/**
 * Notifie les seuls comptes admin.
 *
 * Sert aux incidents que l'admin est le seul à pouvoir traiter — typiquement
 * un recalcul de planning qui a échoué en arrière-plan : sans ça, l'erreur
 * n'existe que dans les logs Vercel et le planning reste silencieusement figé
 * (cf. spec 2026-09-11-recalcul-dispatch-sous-effectif).
 */
export async function notifyAdmins(
  notif: NotificationInput,
): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("members")
    .select("id")
    .eq("is_admin", true);
  if (error) {
    console.error("notifyAdmins (lecture des admins) error:", error);
    return 0;
  }
  return notifyMembers(
    (data || []).map((m: { id: string }) => m.id),
    notif,
  );
}
