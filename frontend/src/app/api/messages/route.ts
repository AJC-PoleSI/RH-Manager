import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { sendDirectMessageEmail } from "@/lib/resend";
import { NextRequest } from "next/server";

/**
 * Nom affiché de l'expéditeur, dérivé UNIQUEMENT du jeton — jamais du corps
 * de la requête. Retombe sur la partie locale de l'email si la fiche n'a pas
 * de nom renseigné.
 */
async function resolveSenderName(user: {
  id: string;
  email: string;
  role: string;
}): Promise<string> {
  const table = user.role === "candidate" ? "candidates" : "members";
  const { data } = await supabaseAdmin
    .from(table)
    .select("first_name, last_name")
    .eq("id", user.id)
    .maybeSingle();

  const full = `${data?.first_name ?? ""} ${data?.last_name ?? ""}`.trim();
  return full || user.email.split("@")[0];
}

/**
 * Destinataire réel, résolu à partir du seul `recipientId`.
 *
 * Le `recipientRole` envoyé par le client n'est pas digne de confiance : il
 * décide dans quelle table on va chercher l'adresse email. On interroge donc
 * les deux tables et on garde celle qui répond — c'est aussi ce qui garantit
 * qu'on n'envoie pas d'email à un id inexistant.
 */
async function resolveRecipient(recipientId: string): Promise<{
  role: "candidate" | "member";
  email: string | null;
  firstName: string | null;
} | null> {
  const [candidate, member] = await Promise.all([
    supabaseAdmin
      .from("candidates")
      .select("id, email, first_name")
      .eq("id", recipientId)
      .maybeSingle(),
    supabaseAdmin
      .from("members")
      .select("id, email, first_name")
      .eq("id", recipientId)
      .maybeSingle(),
  ]);

  if (candidate.data) {
    return {
      role: "candidate",
      email: candidate.data.email,
      firstName: candidate.data.first_name,
    };
  }
  if (member.data) {
    return {
      role: "member",
      email: member.data.email,
      firstName: member.data.first_name,
    };
  }
  return null;
}

/**
 * Nombre de messages renvoyés par conversation-utilisateur. Large de côté
 * pour ne rien tronquer en pratique, mais borné : sans plafond, la charge
 * de cette route grandissait avec l'historique, indéfiniment.
 */
const MESSAGES_WINDOW = 300;

// GET /api/messages - Fetch private messages for current user
export async function GET(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();

  try {
    // Colonnes explicites + fenêtre bornée : cette route est rejouée par le
    // polling de la messagerie. Elle lisait l'INTÉGRALITÉ des messages de
    // l'utilisateur à chaque passage.
    //
    // On prend les N PLUS RÉCENTS (`ascending: false` + `limit`), puis on
    // rétablit l'ordre chronologique pour l'affichage. Trier en ascendant
    // avant de limiter aurait renvoyé les plus ANCIENS — le fil aurait semblé
    // figé une fois le plafond atteint.
    const { data, error } = await supabaseAdmin
      .from("private_messages")
      .select(
        "id, sender_id, sender_role, sender_name, recipient_id, recipient_role, message, read, created_at",
      )
      .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`)
      .order("created_at", { ascending: false })
      .limit(MESSAGES_WINDOW);

    if (error) throw error;

    const messages = (data || []).reverse().map((m: any) => ({
      id: m.id,
      senderId: m.sender_id,
      senderRole: m.sender_role,
      senderName: m.sender_name,
      recipientId: m.recipient_id,
      recipientRole: m.recipient_role,
      text: m.message,
      read: m.read,
      createdAt: m.created_at,
      time: new Date(m.created_at).toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    }));

    return Response.json(messages);
  } catch (error) {
    console.error("Messages GET error:", error);
    return Response.json(
      { error: "Failed to fetch messages" },
      { status: 500 },
    );
  }
}

// POST /api/messages - Send a private message
export async function POST(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();

  try {
    // SECURITY : `senderName` n'est PAS lu depuis le corps de la requête.
    // C'est le champ affiché dans la messagerie ; le recopier tel quel
    // laissait n'importe qui écrire sous une fausse identité — un candidat
    // pouvait s'adresser à un examinateur sous le nom « Admin AJC ».
    // Le nom est reconstruit côté serveur à partir du jeton.
    const { recipientId, message, sendEmail } = await req.json();

    if (!recipientId || !message?.trim()) {
      return Response.json(
        { error: "recipientId and message are required" },
        { status: 400 },
      );
    }

    // Le rôle du destinataire est déduit de la base, pas du client :
    // il détermine à quelle adresse part le doublon email.
    const recipient = await resolveRecipient(recipientId);
    if (!recipient) {
      return Response.json(
        { error: "Destinataire introuvable" },
        { status: 400 },
      );
    }

    let role = "member";
    if (user.role === "candidate") role = "candidate";
    else if (user.isAdmin) role = "admin";

    const senderName = await resolveSenderName(user);

    const { data, error } = await supabaseAdmin
      .from("private_messages")
      .insert({
        sender_id: user.id,
        sender_role: role,
        sender_name: senderName,
        recipient_id: recipientId,
        recipient_role: recipient.role,
        message: message.trim(),
      })
      .select()
      .single();

    if (error) throw error;

    // ── Doublon email (optionnel) ───────────────────────────────────────
    // Réservé aux admins : la messagerie côté candidat/membre est en
    // lecture seule, et ouvrir l'envoi d'email à tous transformerait le
    // chat en relais de spam sur le domaine AJC (quota Resend compris).
    // Fail-soft : le message est déjà enregistré, un email raté ne doit
    // pas faire échouer l'envoi — l'admin voit juste l'avertissement.
    let email: { sent: boolean; error?: string } | undefined;
    if (sendEmail === true) {
      if (!user.isAdmin) {
        email = { sent: false, error: "Envoi email réservé aux admins" };
      } else if (!recipient.email) {
        email = { sent: false, error: "Ce contact n'a pas d'adresse email" };
      } else {
        email = await sendDirectMessageEmail({
          to: recipient.email,
          firstName: recipient.firstName,
          senderName,
          message: message.trim(),
          recipientRole: recipient.role,
        });
      }
    }

    return Response.json(
      {
        id: data.id,
        senderId: data.sender_id,
        senderRole: data.sender_role,
        senderName: data.sender_name,
        recipientId: data.recipient_id,
        recipientRole: data.recipient_role,
        text: data.message,
        read: data.read,
        createdAt: data.created_at,
        time: new Date(data.created_at).toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        emailSent: email?.sent ?? false,
        emailError: email?.error,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Messages POST error:", error);
    return Response.json({ error: "Failed to send message" }, { status: 500 });
  }
}
