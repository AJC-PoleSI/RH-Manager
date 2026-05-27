import { supabaseAdmin } from "@/lib/supabase";
import { signToken } from "@/lib/auth";
import { NextRequest } from "next/server";

// GET /api/auth/verify-email?token=xxx
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token) {
    return Response.json({ error: "Token manquant." }, { status: 400 });
  }

  try {
    // Find candidate with this token
    const { data: candidate, error } = await supabaseAdmin
      .from("candidates")
      .select("id, first_name, last_name, email, phone, date_of_birth, email_verified, verification_token_expires_at")
      .eq("verification_token", token)
      .maybeSingle();

    if (error) throw error;

    if (!candidate) {
      return Response.json(
        { error: "Lien invalide ou déjà utilisé." },
        { status: 400 },
      );
    }

    if (candidate.email_verified) {
      return Response.json(
        { error: "Cet email est déjà vérifié. Vous pouvez vous connecter." },
        { status: 400 },
      );
    }

    // Check expiry
    if (candidate.verification_token_expires_at) {
      const expires = new Date(candidate.verification_token_expires_at);
      if (new Date() > expires) {
        return Response.json(
          {
            error: "Ce lien a expiré. Veuillez demander un nouveau lien de vérification.",
            code: "TOKEN_EXPIRED",
          },
          { status: 400 },
        );
      }
    }

    // Mark as verified, clear token
    const { error: updateError } = await supabaseAdmin
      .from("candidates")
      .update({
        email_verified: true,
        verification_token: null,
        verification_token_expires_at: null,
      })
      .eq("id", candidate.id);

    if (updateError) throw updateError;

    // Issue JWT so the user is logged in right away
    const jwt = signToken({
      id: candidate.id,
      email: candidate.email,
      role: "candidate",
    });

    return Response.json({ token: jwt, candidate });
  } catch (error) {
    console.error("verify-email error:", error);
    return Response.json(
      { error: "Erreur lors de la vérification." },
      { status: 500 },
    );
  }
}
