-- ============================================================
-- Migration : Annonces générales (septembre 2026)
-- ============================================================
-- À copier dans le SQL Editor de Supabase. Idempotent.
--
-- Une annonce = un message écrit par un admin, diffusé à une audience
-- choisie (membres et/ou candidats, avec filtres). Elle crée :
--   - une notification in-app par destinataire (cloche du header) ;
--   - un bandeau sur le dashboard candidat tant qu'elle n'est pas lue ;
--   - éventuellement un email (optionnel, plafonné — cf. quota Resend).
--
-- Deux tables de notifications distinctes parce que `notifications`
-- référence members(id) : un candidat n'y a pas sa place. Même forme, même
-- API côté client (/api/notifications sert les deux selon le rôle).
--
-- Pas de RLS : tables accédées uniquement via la clé service role
-- (supabaseAdmin), jamais directement depuis le navigateur.
-- ============================================================

-- Journal des annonces envoyées : sert d'historique dans l'UI admin ET de
-- compteur pour le quota d'emails du jour (email_sent).
CREATE TABLE IF NOT EXISTS announcements (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title              TEXT NOT NULL,
  body               TEXT NOT NULL,
  target_members     BOOLEAN NOT NULL DEFAULT false,
  member_pole        TEXT,           -- NULL = tous les pôles
  target_candidates  BOOLEAN NOT NULL DEFAULT false,
  candidate_filter   TEXT,           -- all | en_lice | accepted_tour1..3 | refused
  members_count      INTEGER NOT NULL DEFAULT 0,
  candidates_count   INTEGER NOT NULL DEFAULT 0,
  email_requested    BOOLEAN NOT NULL DEFAULT false,
  email_sent         INTEGER NOT NULL DEFAULT 0,
  email_failed       INTEGER NOT NULL DEFAULT 0,
  created_by         UUID REFERENCES members(id) ON DELETE SET NULL,
  created_by_name    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcements_created
  ON announcements (created_at DESC);

-- Notifications côté CANDIDAT (miroir de `notifications`, qui est réservée
-- aux membres). `announcement_id` permet de retirer un bandeau si l'annonce
-- est supprimée.
CREATE TABLE IF NOT EXISTS candidate_notifications (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id     UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  announcement_id  UUID REFERENCES announcements(id) ON DELETE CASCADE,
  type             TEXT NOT NULL DEFAULT 'annonce',
  title            TEXT NOT NULL,
  body             TEXT,
  link             TEXT,
  read_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidate_notifications_candidate
  ON candidate_notifications (candidate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_candidate_notifications_unread
  ON candidate_notifications (candidate_id)
  WHERE read_at IS NULL;

-- Rattachement des notifications MEMBRE à leur annonce (colonne ajoutée à la
-- table existante, sans contrainte NOT NULL : les notifs système n'en ont pas).
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS announcement_id UUID REFERENCES announcements(id) ON DELETE CASCADE;
