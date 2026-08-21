import { supabaseAdmin } from "@/lib/supabase";
import { signToken, isSuperAdminEmail } from "@/lib/auth";
import {
  checkRateLimit,
  registerFailedAttempt,
  resetRateLimit,
} from "@/lib/rate-limit";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return Response.json(
        { error: "Email and password are required." },
        { status: 400 },
      );
    }

    // SECURITY (audit SEC-008): email normalisé en minuscules.
    const emailNorm = String(email).trim().toLowerCase();

    // SECURITY (audit SEC-003): anti-force brute. Blocage après 5 échecs / 15 min.
    const rlKey = `member-login:${emailNorm}`;
    const rl = await checkRateLimit(rlKey);
    if (rl.limited) {
      return Response.json(
        {
          error: `Trop de tentatives de connexion. Réessayez dans ${Math.ceil(
            rl.retryAfterSeconds / 60,
          )} minute(s).`,
        },
        { status: 429 },
      );
    }

    const { data: member, error } = await supabaseAdmin
      .from("members")
      .select("id, email, password_hash, is_admin")
      .eq("email", emailNorm)
      .single();

    // Panne d'infra (base en pause, réseau, RLS…) ≠ mauvais identifiants.
    // PGRST116 = « aucune ligne » : c'est le seul cas où l'absence de
    // résultat signifie réellement « ce compte n'existe pas ». Tout autre
    // code est une erreur serveur : on ne doit ni compter un échec dans le
    // rate limit, ni faire croire à l'utilisateur que son mot de passe est
    // faux (sinon tous les comptes semblent cassés d'un coup).
    if (error && error.code !== "PGRST116") {
      console.error("Login DB error:", error);
      return Response.json(
        {
          error:
            "Service temporairement indisponible (base de données injoignable). Réessayez dans quelques instants.",
        },
        { status: 503 },
      );
    }

    if (!member) {
      await registerFailedAttempt(rlKey);
      return Response.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const validPassword = await bcrypt.compare(password, member.password_hash);

    if (!validPassword) {
      await registerFailedAttempt(rlKey);
      return Response.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Connexion réussie → on remet le compteur à zéro.
    await resetRateLimit(rlKey);

    // Le flag « doit changer son mot de passe » est lu à part et en
    // best-effort : tant que supabase-migration-password-reset.sql n'est pas
    // appliqué, la colonne n'existe pas — et une connexion ne doit jamais
    // échouer pour cette raison.
    let mustChangePassword = false;
    {
      const { data: flags, error: flagError } = await supabaseAdmin
        .from("members")
        .select("must_change_password")
        .eq("id", member.id)
        .maybeSingle();
      if (flagError) {
        console.warn(
          "must_change_password indisponible (migration non appliquée ?)",
          flagError.message,
        );
      } else {
        mustChangePassword = flags?.must_change_password === true;
      }
    }

    const superAdmin = isSuperAdminEmail(member.email);
    const token = signToken({
      id: member.id,
      email: member.email,
      role: "member",
      isAdmin: member.is_admin,
      isSuperAdmin: superAdmin,
    });

    return Response.json({
      token,
      member: {
        id: member.id,
        email: member.email,
        isAdmin: member.is_admin,
        isSuperAdmin: superAdmin,
        // true → le dashboard impose le choix d'un nouveau mot de passe
        // avant toute autre action (cf. ForcePasswordChange).
        mustChangePassword,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return Response.json({ error: "Login failed" }, { status: 500 });
  }
}
