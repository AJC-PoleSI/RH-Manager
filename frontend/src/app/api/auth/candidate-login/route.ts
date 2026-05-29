import { supabaseAdmin } from "@/lib/supabase";
import { signToken } from "@/lib/auth";
import {
  checkRateLimit,
  registerFailedAttempt,
  resetRateLimit,
} from "@/lib/rate-limit";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { email, dateOfBirth } = await req.json();

    if (!email || !dateOfBirth) {
      return Response.json(
        { error: "Email et date de naissance requis." },
        { status: 400 },
      );
    }

    // SECURITY (audit SEC-008): email normalisé en minuscules.
    const emailNorm = String(email).trim().toLowerCase();

    // SECURITY (audit SEC-001 + SEC-003): l'auth candidat repose sur la date
    // de naissance (faible entropie). Le rate limiting est ESSENTIEL ici :
    // blocage après 5 échecs / 15 min, sinon brute-force trivial.
    const rlKey = `candidate-login:${emailNorm}`;
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

    const { data: candidate, error } = await supabaseAdmin
      .from("candidates")
      .select("id, first_name, last_name, email, phone, date_of_birth, email_verified")
      .eq("email", emailNorm)
      .single();

    if (error || !candidate) {
      await registerFailedAttempt(rlKey);
      return Response.json(
        { error: "Candidat introuvable. Vérifiez votre email." },
        { status: 401 },
      );
    }

    // Compare dates (ignore time)
    const dbDate = candidate.date_of_birth;
    if (!dbDate || dbDate !== dateOfBirth) {
      await registerFailedAttempt(rlKey);
      return Response.json(
        { error: "Date de naissance incorrecte." },
        { status: 401 },
      );
    }

    // Block login if email not verified
    if (candidate.email_verified === false) {
      return Response.json(
        {
          error:
            "Veuillez vérifier votre email avant de vous connecter. Consultez votre boîte mail.",
          code: "EMAIL_NOT_VERIFIED",
          email: candidate.email,
        },
        { status: 403 },
      );
    }

    // Identifiants corrects et email vérifié → reset du compteur.
    await resetRateLimit(rlKey);

    const token = signToken({
      id: candidate.id,
      email: candidate.email,
      role: "candidate",
    });

    return Response.json({ token, candidate });
  } catch (error) {
    console.error("Candidate login error:", error);
    return Response.json(
      { error: "Erreur de connexion candidat." },
      { status: 500 },
    );
  }
}
