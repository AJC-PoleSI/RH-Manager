-- ============================================================
-- Vérification d'email candidat — colonnes manquantes des migrations
-- (audit du 09/09/2026)
-- ============================================================
-- `email_verified`, `verification_token` et `verification_token_expires_at`
-- sont utilisées par POST /api/auth/register-candidate, verify-email,
-- candidate-login et resend-verification, mais n'existent dans aucun fichier
-- de migration du dépôt (probablement ajoutées à la main en prod). Sans
-- elles, l'inscription candidate échoue immédiatement (Postgres 42703) sur
-- toute base reconstruite depuis le repo.

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_token TEXT,
  ADD COLUMN IF NOT EXISTS verification_token_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_candidates_verification_token
  ON candidates (verification_token)
  WHERE verification_token IS NOT NULL;
