-- ============================================
-- Migration: Notifications in-app (Tour 3)
-- ============================================
-- À copier dans le SQL Editor de Supabase.
--
-- Notifications destinées aux membres (cloche dans le header du
-- dashboard). Utilisé notamment au Tour 3 pour prévenir les membres
-- d'un pôle que des candidats doivent passer leurs épreuves.
--
-- Pas de RLS : table accédée uniquement via la clé service role
-- (supabaseAdmin), jamais directement depuis le client.
-- ============================================

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id   UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'info',
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_member
  ON notifications (member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (member_id)
  WHERE read_at IS NULL;
