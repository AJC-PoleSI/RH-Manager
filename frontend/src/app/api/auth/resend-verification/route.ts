import { supabaseAdmin } from "@/lib/supabase";
import { sendResendVerificationEmail } from "@/lib/resend";
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

    const { data: candidate, error } = await supabaseAdmin
      .from("candidates")
      .select("id, first_name, email, email_verified")
      .eq("email", email.trim().toLowerCase())
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
