-- Migration: add inscription_deadline to epreuves table
-- and session_token to candidates table

-- Per-epreuve inscription deadline (UTC timestamp)
ALTER TABLE epreuves
  ADD COLUMN IF NOT EXISTS inscription_deadline TIMESTAMPTZ DEFAULT NULL;

-- Single-session enforcement for candidates
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS session_token TEXT DEFAULT NULL;
