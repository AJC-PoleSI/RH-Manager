-- ============================================
-- Migration: « Respo de pôle » sur la fiche membre
-- ============================================
-- Information seulement (aucun effet sur le dispatch) — demandé par Felix
-- le 02/10/2026 « au cas où ».
ALTER TABLE members ADD COLUMN IF NOT EXISTS is_pole_lead BOOLEAN NOT NULL DEFAULT false;
