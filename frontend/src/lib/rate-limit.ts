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

// ════════════════════════════════════════════════════════════════════════════
// Quota d'abus (audit du 19/08/2026, point #5)
//
// `registerFailedAttempt` ne compte que les ÉCHECS : c'est le bon modèle pour
// un login, pas pour un endpoint qui envoie un email. Sur inscription et
// renvoi de vérification, chaque appel RÉUSSI coûte un email — il faut donc
// compter toutes les tentatives, abouties ou non.
// ════════════════════════════════════════════════════════════════════════════

/** IP de l'appelant derrière le proxy Vercel. "unknown" si indéterminable. */
export function clientIp(req: { headers: Headers }): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Consomme une unité de quota. Contrairement à registerFailedAttempt, compte
 * CHAQUE appel. Retourne `limited: true` si le seuil est déjà atteint — dans
 * ce cas l'appelant doit répondre 429 sans exécuter l'action.
 *
 * Fail-open comme le reste du module : une panne de la table ne doit pas
 * bloquer les inscriptions.
 */
export async function consumeQuota(
  key: string,
  config: Partial<RateLimitConfig> = {},
): Promise<RateLimitStatus> {
  const status = await checkRateLimit(key);
  if (status.limited) return status;
  return registerFailedAttempt(key, config);
}

/** Quotas par défaut pour les endpoints qui envoient un email. */
export const EMAIL_QUOTA: RateLimitConfig = {
  maxAttempts: 5,
  windowSeconds: 60 * 60, // 1 h
  lockSeconds: 60 * 60,
};

/** Quota par IP, plus large : plusieurs personnes peuvent partager une IP. */
export const IP_QUOTA: RateLimitConfig = {
  maxAttempts: 15,
  windowSeconds: 60 * 60,
  lockSeconds: 60 * 60,
};
