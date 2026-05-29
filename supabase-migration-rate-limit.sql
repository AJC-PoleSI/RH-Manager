-- ============================================
-- SEC-003 : table de rate limiting anti-force brute
-- ============================================
-- Utilisée par frontend/src/lib/rate-limit.ts pour bloquer les tentatives
-- de connexion répétées (login membre + candidat).
--
-- Une ligne par "clé" (ex: "member-login:jean@x.com").
--   attempts      : nb d'échecs dans la fenêtre courante
--   window_start  : début de la fenêtre glissante
--   locked_until  : si renseigné et dans le futur => connexion bloquée
-- ============================================

CREATE TABLE IF NOT EXISTS rate_limit_attempts (
  key           TEXT PRIMARY KEY,
  attempts      INTEGER NOT NULL DEFAULT 0,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index pour purger facilement les verrous expirés si besoin.
CREATE INDEX IF NOT EXISTS idx_rate_limit_locked_until
  ON rate_limit_attempts (locked_until);

-- (Optionnel) Purge périodique des lignes anciennes — à lancer manuellement
-- ou via un cron Supabase :
-- DELETE FROM rate_limit_attempts
-- WHERE updated_at < now() - interval '1 day'
--   AND (locked_until IS NULL OR locked_until < now());
