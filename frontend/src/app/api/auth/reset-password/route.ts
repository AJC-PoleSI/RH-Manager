import { supabaseAdmin } from "@/lib/supabase";
import { signToken, isSuperAdminEmail } from "@/lib/auth";
import { hashResetToken, validatePassword } from "@/lib/password";
import { resetRateLimit } from "@/lib/rate-limit";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";

/**
 * Retrouve le membre porteur d'un jeton encore valide.
 * Renvoie `null` si le jeton est inconnu, déjà consommé ou expiré.
 */
async function findMemberByResetToken(token: string) {
  const { data: member } = await supabaseAdmin
    .from("members")
    .select("id, email, first_name, is_admin, password_reset_expires_at")
    .eq("password_reset_token", hashResetToken(token))
    .maybeSingle();

  if (!member) return null;
  if (
    !member.password_reset_expires_at ||
    new Date(member.password_reset_expires_at) < new Date()
  ) {
    return null;
  }
  return member;
}

// GET /api/auth/reset-password?token=xxx
// Vérifie la validité d'un lien AVANT d'afficher le formulaire.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return Response.json({ error: "Lien invalide." }, { status: 400 });
  }

  const member = await findMemberByResetToken(token);
  if (!member) {
    return Response.json(
      {
        error:
          "Ce lien est invalide ou a expiré. Demandez-en un nouveau depuis « Mot de passe oublié ? ».",
        code: "TOKEN_INVALID",
      },
      { status: 400 },
    );
  }

  return Response.json({ valid: true, email: member.email });
}

// POST /api/auth/reset-password  { token, password }
// Applique le nouveau mot de passe et consomme le jeton.
export async function POST(req: NextRequest) {
  try {
    const { token, password } = await req.json();

    if (!token || !password) {
      return Response.json(
        { error: "Lien et mot de passe requis." },
        { status: 400 },
      );
    }

    const pwError = validatePassword(password);
    if (pwError) return Response.json({ error: pwError }, { status: 400 });

    const member = await findMemberByResetToken(token);
    if (!member) {
      return Response.json(
        {
          error:
            "Ce lien est invalide ou a expiré. Demandez-en un nouveau depuis « Mot de passe oublié ? ».",
          code: "TOKEN_INVALID",
        },
        { status: 400 },
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const { error } = await supabaseAdmin
      .from("members")
      .update({
        password_hash: passwordHash,
        // Le jeton est à usage unique : on le consomme ici.
        password_reset_token: null,
        password_reset_expires_at: null,
        must_change_password: false,
        password_changed_at: new Date().toISOString(),
      })
      .eq("id", member.id);

    if (error) throw error;

    // Le compte vient d'être repris en main : on lève un éventuel blocage
    // anti-force brute hérité des tentatives ratées.
    await resetRateLimit(`member-login:${member.email}`);

    // Connexion immédiate, comme après la vérification d'email.
    const jwt = signToken({
      id: member.id,
      email: member.email,
      role: "member",
      isAdmin: member.is_admin,
      isSuperAdmin: isSuperAdminEmail(member.email),
    });

    return Response.json({
      token: jwt,
      member: {
        id: member.id,
        email: member.email,
        firstName: member.first_name || "",
        isAdmin: member.is_admin,
        isSuperAdmin: isSuperAdminEmail(member.email),
        mustChangePassword: false,
      },
    });
  } catch (error) {
    console.error("reset-password error:", error);
    return Response.json(
      { error: "Erreur lors de la réinitialisation du mot de passe." },
      { status: 500 },
    );
  }
}
