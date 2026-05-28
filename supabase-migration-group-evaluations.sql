-- ============================================
-- Migration: Group evaluations
-- ============================================
-- Adds support for two-tier evaluations on group épreuves:
--   • One SHARED group evaluation (is_group = true) per (candidate, epreuve)
--     editable by every member assigned to a slot of that épreuve.
--   • One INDIVIDUAL evaluation per (member, candidate, epreuve) — existing behavior.
-- ============================================

ALTER TABLE candidate_evaluations
  ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE candidate_evaluations
  ADD COLUMN IF NOT EXISTS last_edited_by UUID REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE candidate_evaluations
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Index to make group lookups fast
CREATE INDEX IF NOT EXISTS idx_candidate_evaluations_group
  ON candidate_evaluations (candidate_id, epreuve_id)
  WHERE is_group = true;

-- Ensure at most ONE group eval per (candidate, epreuve)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_candidate_evaluations_group
  ON candidate_evaluations (candidate_id, epreuve_id)
  WHERE is_group = true;

-- Ensure at most ONE individual eval per (candidate, epreuve, member)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_candidate_evaluations_individual
  ON candidate_evaluations (candidate_id, epreuve_id, member_id)
  WHERE is_group = false;
