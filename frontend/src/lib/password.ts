import crypto from "crypto";

// ════════════════════════════════════════════════════════════════════
// Politique de mot de passe + jetons de réinitialisation (membres).
//
// Le jeton envoyé par email est aléatoire (32 octets) ; seule son
// empreinte SHA-256 est stockée en base (`members.password_reset_token`).
// Une lecture de la table ne permet donc pas de rejouer un lien.
// ════════════════════════════════════════════════════════════════════

/** Durée de validité d'un lien de réinitialisation. */
export const RESET_TOKEN_TTL_HOURS = 24;

/** Règle unique : 8 caractères minimum, 1 majuscule, 1 chiffre. */
export function validatePassword(password: string): string | null {
  if (!password || password.length < 8)
    return "Le mot de passe doit contenir au moins 8 caractères.";
  if (!/[A-Z]/.test(password))
    return "Le mot de passe doit contenir au moins une majuscule.";
  if (!/[0-9]/.test(password))
    return "Le mot de passe doit contenir au moins un chiffre.";
  return null;
}

/** Empreinte stockée en base pour un jeton donné. */
export function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export interface ResetToken {
  /** À mettre dans le lien envoyé par email. Jamais stocké. */
  token: string;
  /** À écrire dans members.password_reset_token. */
  tokenHash: string;
  /** À écrire dans members.password_reset_expires_at. */
  expiresAt: string;
}

export function createResetToken(): ResetToken {
  const token = crypto.randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: hashResetToken(token),
    expiresAt: new Date(
      Date.now() + RESET_TOKEN_TTL_HOURS * 60 * 60 * 1000,
    ).toISOString(),
  };
}
