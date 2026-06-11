-- ============================================
-- Migration: ordre d'affectation des examinateurs (titulaire/remplaçant)
-- ============================================
-- Ajoute created_at sur slot_member_assignments pour déterminer l'ordre
-- d'inscription : les N premiers (= min_members du créneau) sont les
-- examinateurs TITULAIRES, les suivants sont des REMPLAÇANTS.
--
-- À copier dans le SQL Editor de Supabase.
-- ============================================

ALTER TABLE slot_member_assignments
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_slot_assignments_created
  ON slot_member_assignments (slot_id, created_at);
