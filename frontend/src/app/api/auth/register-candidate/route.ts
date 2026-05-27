import { supabaseAdmin } from "@/lib/supabase";
import { signToken } from "@/lib/auth";
import { sendVerificationEmail } from "@/lib/resend";
import { NextRequest } from "next/server";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      dateOfBirth,
      formation,
      etablissement,
      anneeIntegration,
    } = await req.json();

    if (!firstName || !lastName || !email || !dateOfBirth) {
      return Response.json(
        {
          error:
            "Les champs Prénom, Nom, Email et Date de naissance sont obligatoires.",
        },
        { status: 400 },
      );
    }

    // ══════════════════════════════════════════════════════════════════
    // SECURITY: only Audencia email addresses can register as candidate.
    // This is the SERVER-SIDE check — a client-side check alone is
    // bypassable. Both audencia.com (staff/students) and the legacy
    // audencia-bs.com domain are accepted.
    // ══════════════════════════════════════════════════════════════════
    const emailLower = String(email).trim().toLowerCase();
    const audenciaDomainRe = /@(audencia\.com|audencia-bs\.com)$/;
    if (!audenciaDomainRe.test(emailLower)) {
      return Response.json(
        {
          error:
            "Inscription réservée aux adresses Audencia (@audencia.com). Veuillez utiliser votre email institutionnel.",
        },
        { status: 400 },
      );
    }

    // Check registration window: ouverture = deadline_candidats, fermeture = deadline_membres
    const { data: windowSettings } = await supabaseAdmin
      .from("system_settings")
      .select("key, value")
      .in("key", ["deadline_candidats", "deadline_membres"]);

    const settingsMap: Record<string, string> = {};
    for (const row of windowSettings || []) settingsMap[row.key] = row.value;

    const parseDate = (val: string | undefined): Date | null => {
      if (!val || val.trim() === "") return null;
      let raw = val.trim();
      if (!raw.endsWith("Z") && !raw.match(/[+-]\d{2}:\d{2}$/)) raw += "Z";
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    };

    const ouverture = parseDate(settingsMap["deadline_candidats"]);
    const fermeture = parseDate(settingsMap["deadline_membres"]);
    const now = new Date();

    if (ouverture && now < ouverture) {
      const formatted = ouverture.toLocaleString("fr-FR", {
        timeZone: "Europe/Paris",
      });
      return Response.json(
        {
          error: `Les inscriptions ne sont pas encore ouvertes. Ouverture le ${formatted}.`,
        },
        { status: 403 },
      );
    }

    if (fermeture && now > fermeture) {
      const formatted = fermeture.toLocaleString("fr-FR", {
        timeZone: "Europe/Paris",
      });
      return Response.json(
        {
          error: `Les inscriptions sont fermées. La date limite était le ${formatted}.`,
        },
        { status: 403 },
      );
    }

    // Generate email verification token
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationTokenExpiresAt = new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    ).toISOString();

    // Create the candidate
    const { data: candidate, error } = await supabaseAdmin
      .from("candidates")
      .insert({
        first_name: firstName,
        last_name: lastName,
        email,
        phone: phone || null,
        date_of_birth: dateOfBirth,
        formation: formation || null,
        etablissement: etablissement || null,
        annee_integration: anneeIntegration || null,
        email_verified: false,
        verification_token: verificationToken,
        verification_token_expires_at: verificationTokenExpiresAt,
      })
      .select("id, first_name, last_name, email, phone, date_of_birth")
      .single();

    if (error) {
      if (error.code === "23505") {
        // Email already exists — check if the account is unverified.
        // If so, resend a fresh verification link and show the pending page
        // instead of a cold error message.
        const { data: existing } = await supabaseAdmin
          .from("candidates")
          .select("id, first_name, email, email_verified")
          .eq("email", emailLower)
          .maybeSingle();

        if (existing && !existing.email_verified) {
          const newToken = crypto.randomBytes(32).toString("hex");
          const newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          await supabaseAdmin
            .from("candidates")
            .update({ verification_token: newToken, verification_token_expires_at: newExpiry })
            .eq("id", existing.id);
          try {
            await sendVerificationEmail(existing.email, existing.first_name, newToken);
          } catch (emailErr) {
            console.error("Failed to resend verification email:", emailErr);
          }
          return Response.json({ emailPending: true, email: existing.email }, { status: 200 });
        }

        return Response.json(
          {
            error:
              'Un candidat avec cet email existe déjà. Utilisez "Se connecter" à la place.',
          },
          { status: 400 },
        );
      }
      return Response.json(
        { error: "Échec de l'inscription.", details: error.message },
        { status: 400 },
      );
    }

    // Send verification email (best-effort — don't fail registration if it fails)
    try {
      await sendVerificationEmail(candidate.email, candidate.first_name, verificationToken);
    } catch (emailErr) {
      console.error("Failed to send verification email:", emailErr);
    }

    return Response.json({ emailPending: true, email: candidate.email }, { status: 201 });
  } catch (error) {
    console.error("registerCandidate error:", error);
    return Response.json(
      { error: "Échec de l'inscription.", details: String(error) },
      { status: 400 },
    );
  }
}
