import { supabaseAdmin, isMissingTableError } from "@/lib/supabase";
import { signToken, isSuperAdminEmail } from "@/lib/auth";
import { BCRYPT_COST, hashResetToken, validatePassword } from "@/lib/password";
import { resetRateLimit } from "@/lib/rate-limit";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";

/** Schéma incomplet : les colonnes password_reset_* ne sont pas encore posées. */
class MissingResetSchemaError extends Error {
  constructor() {
    super("password_reset schema missing");
    this.name = "MissingResetSchemaError";
  }
}

/** 503 explicite plutôt qu'un « lien invalide » trompeur. */
function migrationPendingResponse() {
  return Response.json(
    {
      error:
        "La réinitialisation de mot de passe est indisponible : une migration " +
        "de base de données reste à appliquer. Contactez un administrateur.",
      migrationPending: true,
    },
    { status: 503 },
  );
}

/**
 * Retrouve le membre porteur d'un jeton encore valide.
 * Renvoie `null` si le jeton est inconnu, déjà consommé ou expiré.
 */
async function findMemberByResetToken(token: string) {
  const { data: member, error } = await supabaseAdmin
    .from("members")
    .select("id, email, first_name, is_admin, password_reset_expires_at")
    .eq("password_reset_token", hashResetToken(token))
    .maybeSingle();

  // Audit du 07/09/2026 : l'erreur du select était ignorée. Tant que la
  // migration `password-reset` n'est pas posée, les colonnes n'existent pas,
  // Supabase renvoie une erreur, `member` vaut null — et TOUT lien de
  // réinitialisation répondait « lien invalide ou expiré », y compris un jeton
  // fraîchement émis, sans aucune trace exploitable côté serveur. On distingue
  // désormais « schéma incomplet » (500 + log explicite) de « jeton invalide ».
  if (error) {
    if (isMissingTableError(error)) {
      console.error(
        "[auth/reset-password] Colonnes password_reset_* absentes : appliquer " +
          "la section « password-reset » de MIGRATIONS_A_APPLIQUER.sql.",
      );
      throw new MissingResetSchemaError();
    }
    console.error("[auth/reset-password] Lecture du jeton échouée:", error);
    throw error;
  }

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

  try {
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
  } catch (error) {
    if (error instanceof MissingResetSchemaError) {
      return migrationPendingResponse();
    }
    console.error("[auth/reset-password] GET error:", error);
    return Response.json(
      { error: "Vérification du lien impossible." },
      { status: 500 },
    );
  }
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

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

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
