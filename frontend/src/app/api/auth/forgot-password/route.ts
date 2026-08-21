import { supabaseAdmin } from "@/lib/supabase";
import {
  consumeQuota,
  clientIp,
  EMAIL_QUOTA,
  IP_QUOTA,
} from "@/lib/rate-limit";
import { issueResetLink } from "@/lib/password-reset-service";
import { NextRequest } from "next/server";

// POST /api/auth/forgot-password  { email }
//
// Envoie au membre un lien pour choisir un nouveau mot de passe.
//
// SÉCURITÉ : la réponse est TOUJOURS { ok: true }, que l'adresse existe ou
// non — sinon la route devient un oracle permettant d'énumérer les comptes
// AJC. Double quota (email + IP) comme /api/auth/resend-verification : un
// appel = un email envoyé.
export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== "string") {
      return Response.json({ error: "Email requis." }, { status: 400 });
    }

    const emailNorm = email.trim().toLowerCase();

    const tooMany =
      (await consumeQuota(`forgot-pwd:${emailNorm}`, EMAIL_QUOTA)).limited ||
      (await consumeQuota(`forgot-pwd-ip:${clientIp(req)}`, IP_QUOTA)).limited;
    if (tooMany) {
      return Response.json({ ok: true });
    }

    const { data: member } = await supabaseAdmin
      .from("members")
      .select("id, email, first_name")
      .eq("email", emailNorm)
      .maybeSingle();

    if (member) {
      await issueResetLink(member, "reset");
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("forgot-password error:", error);
    // Même en cas d'erreur interne : aucun signal sur l'existence du compte.
    return Response.json({ ok: true });
  }
}
