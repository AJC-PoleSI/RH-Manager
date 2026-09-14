/**
 * system-messages — les messages automatiques envoyés « par le Système ».
 *
 * BUG CORRIGÉ LE 14/09/2026 : `private_messages.sender_id` est NOT NULL en
 * base. Les neuf endroits qui inséraient `sender_id: null` (changement de
 * salle, créneau supprimé, épreuve modifiée, réinitialisation, fusion,
 * sous-effectif, demande de remplaçant, ouverture de créneaux, déplacement
 * de candidat) échouaient donc TOUS en production. L'insertion étant
 * best-effort — try/catch + console.error, pour qu'une notification ratée
 * n'annule jamais l'action métier — l'échec ne se voyait nulle part :
 * l'admin voyait son action réussir, le destinataire ne recevait rien.
 * Constat en base : 0 message « Système » sur 10 messages depuis l'origine.
 *
 * Ces messages partent désormais sous l'identité du compte super-admin, qui
 * est déjà celle qu'ils affichent à l'écran (« Système »).
 */
import { supabaseAdmin } from "@/lib/supabase";

// Même valeur que `SUPER_ADMIN_EMAIL` de lib/auth, relue ici plutôt
// qu'importée : lib/auth lève à l'import si JWT_SECRET est absent, ce qui
// rendrait ce module intestable et lierait l'envoi d'un message à la
// configuration des jetons.
const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL ?? "admin@ajc.fr")
  .trim()
  .toLowerCase();

export interface SystemMessageTarget {
  recipientId: string;
  recipientRole: "candidate" | "member";
  message: string;
}

/** Ligne `private_messages` prête à insérer. */
export function systemMessageRow(
  senderId: string,
  t: SystemMessageTarget,
): Record<string, unknown> {
  return {
    sender_id: senderId,
    sender_role: "admin",
    sender_name: "Système",
    recipient_id: t.recipientId,
    recipient_role: t.recipientRole,
    message: t.message,
  };
}

// Résolu une fois par instance : le compte ne change pas en cours de vie.
// `undefined` = pas encore cherché, `null` = cherché et introuvable (on ne
// remet pas la base à contribution à chaque message dans ce cas).
let cachedSenderId: string | null | undefined;

/**
 * Identité sous laquelle partent les messages système : le super-admin, ou à
 * défaut le plus ancien compte admin — pour qu'un déploiement sans compte
 * `admin@ajc.fr` ne fasse pas disparaître toutes les notifications.
 */
export async function systemSenderId(): Promise<string | null> {
  if (cachedSenderId !== undefined) return cachedSenderId;

  const { data: superAdmin } = await supabaseAdmin
    .from("members")
    .select("id")
    .eq("email", SUPER_ADMIN_EMAIL)
    .maybeSingle();

  if (superAdmin?.id) {
    cachedSenderId = superAdmin.id as string;
    return cachedSenderId;
  }

  const { data: anyAdmin } = await supabaseAdmin
    .from("members")
    .select("id")
    .eq("is_admin", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  cachedSenderId = (anyAdmin?.id as string) ?? null;
  if (!cachedSenderId) {
    console.error(
      "system-messages : aucun compte admin trouvé, messages système non envoyés.",
    );
  }
  return cachedSenderId;
}

/**
 * Envoie des messages privés « Système ». Best-effort : renvoie le nombre de
 * destinataires servis, 0 en cas d'échec (journalisé). Ne lève jamais — une
 * notification ratée ne doit pas annuler l'action métier qui l'a déclenchée.
 */
export async function sendSystemMessages(
  targets: SystemMessageTarget[],
): Promise<number> {
  if (targets.length === 0) return 0;
  try {
    const senderId = await systemSenderId();
    if (!senderId) return 0;
    const { error } = await supabaseAdmin
      .from("private_messages")
      .insert(targets.map((t) => systemMessageRow(senderId, t)));
    if (error) throw error;
    return targets.length;
  } catch (e) {
    console.error("sendSystemMessages:", e);
    return 0;
  }
}
