import { supabaseAdmin } from "@/lib/supabase";
import { sendPasswordResetEmail } from "@/lib/resend";
import { createResetToken, RESET_TOKEN_TTL_HOURS } from "@/lib/password";

export interface ResettableMember {
  id: string;
  email: string;
  first_name?: string | null;
}

/**
 * Émet un lien de réinitialisation pour un membre et l'envoie par email.
 *
 * Écrit l'empreinte du jeton + son expiration sur la ligne `members`, ce qui
 * invalide au passage tout lien précédemment envoyé (un seul lien actif à la
 * fois). `forceChange` marque en plus le compte comme devant choisir un
 * nouveau mot de passe à la prochaine connexion.
 *
 * Ne lève pas : renvoie `{ ok: false, error }` pour que les envois en masse
 * puissent continuer malgré un échec isolé.
 */
export async function issueResetLink(
  member: ResettableMember,
  mode: "reset" | "invite" = "reset",
  forceChange = false,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { token, tokenHash, expiresAt } = createResetToken();

  const update: Record<string, unknown> = {
    password_reset_token: tokenHash,
    password_reset_expires_at: expiresAt,
  };
  if (forceChange) update.must_change_password = true;

  const { error } = await supabaseAdmin
    .from("members")
    .update(update)
    .eq("id", member.id);

  if (error) {
    console.error("issueResetLink DB error:", error);
    // Cas le plus probable en prod : la migration n'a pas encore été
    // appliquée dans Supabase. On le dit explicitement plutôt que de
    // laisser un « erreur inconnue » opaque.
    const missingColumn = /column .* does not exist|password_reset_token/i.test(
      `${error.message} ${error.details ?? ""}`,
    );
    return {
      ok: false,
      error: missingColumn
        ? "Colonnes de réinitialisation absentes : appliquez supabase-migration-password-reset.sql dans Supabase."
        : error.message,
    };
  }

  try {
    await sendPasswordResetEmail(
      member.email,
      member.first_name || "",
      token,
      mode,
      RESET_TOKEN_TTL_HOURS,
    );
    return { ok: true };
  } catch (e: any) {
    console.error("issueResetLink email error:", e);
    return { ok: false, error: e?.message || "Envoi de l'email impossible" };
  }
}
