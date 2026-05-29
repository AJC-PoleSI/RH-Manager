import { supabaseAdmin } from "@/lib/supabase";

// ════════════════════════════════════════════════════════════════════
// Rate limiting persistant (audit SEC-003) — basé sur Supabase pour être
// fiable en serverless (la mémoire d'une fonction n'est pas partagée).
//
// Table requise (cf supabase-migration-rate-limit.sql) :
//   rate_limit_attempts(key TEXT PK, attempts INT, window_start TIMESTAMPTZ,
//                       locked_until TIMESTAMPTZ, updated_at TIMESTAMPTZ)
//
// Stratégie « fail-open » : si la table est absente ou la requête échoue,
// on NE bloque PAS la connexion (priorité à la disponibilité). La sécurité
// repose sur le bon fonctionnement de la table, pas sur son indisponibilité.
// ════════════════════════════════════════════════════════════════════

export interface RateLimitConfig {
  /** Nombre d'échecs tolérés dans la fenêtre avant blocage. */
  maxAttempts: number;
  /** Durée de la fenêtre glissante de comptage (secondes). */
  windowSeconds: number;
  /** Durée du blocage une fois le seuil atteint (secondes). */
  lockSeconds: number;
}

export interface RateLimitStatus {
  limited: boolean;
  retryAfterSeconds: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxAttempts: 5,
  windowSeconds: 15 * 60, // 15 min
  lockSeconds: 15 * 60, // 15 min
};

/**
 * Vérifie si une clé est actuellement bloquée. Lecture seule.
 * À appeler AVANT de traiter une tentative de connexion.
 */
export async function checkRateLimit(key: string): Promise<RateLimitStatus> {
  try {
    const { data } = await supabaseAdmin
      .from("rate_limit_attempts")
      .select("locked_until")
      .eq("key", key)
      .maybeSingle();

    if (data?.locked_until) {
      const until = new Date(data.locked_until).getTime();
      const now = Date.now();
      if (until > now) {
        return {
          limited: true,
          retryAfterSeconds: Math.ceil((until - now) / 1000),
        };
      }
    }
  } catch (e) {
    console.error("checkRateLimit error (fail-open):", e);
  }
  return { limited: false, retryAfterSeconds: 0 };
}

/**
 * Enregistre un échec : incrémente le compteur dans la fenêtre glissante
 * et pose un verrou si le seuil est atteint. Retourne le statut résultant.
 * À appeler APRÈS un échec d'authentification (mauvais mdp / identifiants).
 */
export async function registerFailedAttempt(
  key: string,
  config: Partial<RateLimitConfig> = {},
): Promise<RateLimitStatus> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const now = Date.now();

  try {
    const { data } = await supabaseAdmin
      .from("rate_limit_attempts")
      .select("attempts, window_start")
      .eq("key", key)
      .maybeSingle();

    let attempts = 1;
    let windowStart = new Date(now).toISOString();

    if (data) {
      const ws = new Date(data.window_start).getTime();
      if (now - ws < cfg.windowSeconds * 1000) {
        // Toujours dans la fenêtre → on incrémente.
        attempts = (data.attempts || 0) + 1;
        windowStart = data.window_start;
      }
      // Sinon fenêtre expirée → on repart à 1 (valeurs par défaut ci-dessus).
    }

    let lockedUntil: string | null = null;
    let retryAfter = 0;
    if (attempts >= cfg.maxAttempts) {
      lockedUntil = new Date(now + cfg.lockSeconds * 1000).toISOString();
      retryAfter = cfg.lockSeconds;
    }

    await supabaseAdmin.from("rate_limit_attempts").upsert(
      {
        key,
        attempts,
        window_start: windowStart,
        locked_until: lockedUntil,
        updated_at: new Date(now).toISOString(),
      },
      { onConflict: "key" },
    );

    return { limited: !!lockedUntil, retryAfterSeconds: retryAfter };
  } catch (e) {
    console.error("registerFailedAttempt error (fail-open):", e);
    return { limited: false, retryAfterSeconds: 0 };
  }
}

/**
 * Réinitialise le compteur après une connexion réussie.
 */
export async function resetRateLimit(key: string): Promise<void> {
  try {
    await supabaseAdmin.from("rate_limit_attempts").delete().eq("key", key);
  } catch (e) {
    console.error("resetRateLimit error:", e);
  }
}
