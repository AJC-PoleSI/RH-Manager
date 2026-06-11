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

    if (error || !member) {
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
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return Response.json({ error: "Login failed" }, { status: 500 });
  }
}
