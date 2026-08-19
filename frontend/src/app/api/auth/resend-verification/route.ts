import { supabaseAdmin } from "@/lib/supabase";
import { sendResendVerificationEmail } from "@/lib/resend";
import {
  consumeQuota,
  clientIp,
  EMAIL_QUOTA,
  IP_QUOTA,
} from "@/lib/rate-limit";
import { NextRequest } from "next/server";
import crypto from "crypto";

// POST /api/auth/resend-verification
// Body: { email }
export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email) {
      return Response.json({ error: "Email requis." }, { status: 400 });
    }

    // SECURITY (audit du 19/08/2026, point #5) : sans quota, cette route est
    // une machine à email bombing — un appel = un mail vers l'adresse de son
    // choix. Double clé : par email (protège la boîte visée) et par IP
    // (protège le quota Resend d'un attaquant qui balaie les adresses).
    const emailNorm = String(email).trim().toLowerCase();
    const tooMany =
      (await consumeQuota(`resend-verif:${emailNorm}`, EMAIL_QUOTA)).limited ||
      (await consumeQuota(`resend-verif-ip:${clientIp(req)}`, IP_QUOTA)).limited;
    if (tooMany) {
      // Réponse volontairement identique au cas nominal : ne pas donner à
      // l'attaquant de signal sur l'existence du compte (anti-énumération,
      // cohérent avec le 200 renvoyé plus bas quand le candidat est inconnu).
      return Response.json({ success: true });
    }

    const { data: candidate, error } = await supabaseAdmin
      .from("candidates")
      .select("id, first_name, email, email_verified")
      .eq("email", emailNorm)
      .maybeSingle();

    if (error) throw error;

    // Return 200 even if not found (anti-enumeration)
    if (!candidate) {
      return Response.json({ success: true });
    }

    if (candidate.email_verified) {
      return Response.json(
        { error: "Cet email est déjà vérifié." },
        { status: 400 },
      );
    }

    // Generate new token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await supabaseAdmin
      .from("candidates")
      .update({ verification_token: token, verification_token_expires_at: expiresAt })
      .eq("id", candidate.id);

    await sendResendVerificationEmail(candidate.email, candidate.first_name, token);

    return Response.json({ success: true });
  } catch (error) {
    console.error("resend-verification error:", error);
    return Response.json(
      { error: "Erreur lors de l'envoi." },
      { status: 500 },
    );
  }
}
