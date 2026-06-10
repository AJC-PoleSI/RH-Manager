-- ============================================
-- Migration: Collaboration examinateurs (Tour 1)
-- ============================================
-- À copier dans le SQL Editor de Supabase.
--
--   • group_comments : fil de commentaires partagé entre les examinateurs
--     d'un créneau d'épreuve de groupe (chacun ajoute, tout le monde voit).
--   • examiner_targets : cochage "qui examine qui" avant une épreuve de
--     groupe — chaque examinateur coche les candidats qu'il observera.
--
-- Pas de RLS : ces tables ne sont accédées que via la clé service role
-- (supabaseAdmin), jamais directement depuis le client.
-- ============================================

CREATE TABLE IF NOT EXISTS group_comments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slot_id     UUID NOT NULL REFERENCES evaluation_slots(id) ON DELETE CASCADE,
  epreuve_id  UUID NOT NULL REFERENCES epreuves(id) ON DELETE CASCADE,
  member_id   UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  comment     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_comments_slot
  ON group_comments (slot_id, created_at);

CREATE TABLE IF NOT EXISTS examiner_targets (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slot_id      UUID NOT NULL REFERENCES evaluation_slots(id) ON DELETE CASCADE,
  member_id    UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slot_id, member_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_examiner_targets_slot
  ON examiner_targets (slot_id);
