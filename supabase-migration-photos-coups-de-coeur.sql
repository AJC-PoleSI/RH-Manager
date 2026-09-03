-- ════════════════════════════════════════════════════════════════════════════
-- ORGANIGRAMME DES CANDIDATS — photos + coups de cœur
-- (septembre 2026)
--
-- Deux besoins :
--   1. Un trombinoscope : chaque candidat dépose sa photo depuis son espace,
--      le jury la retrouve dans l'organigramme ET pendant la délibération.
--   2. Un « coup de cœur » : chaque membre dispose de 5 cœurs pour tout le
--      recrutement, un seul cœur par candidat. Un cœur posé sur un candidat
--      éliminé ne compte plus dans le quota (il est réutilisable).
--
-- Les deux tables sont écrites UNIQUEMENT par les routes API via la clé
-- service_role. RLS activée sans policy = fermée à anon/authenticated,
-- conformément à supabase-migration-rls-lockdown.sql.
-- ════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── 1. Photos ──────────────────────────────────────────────────────────────
-- Table séparée de `candidates` À DESSEIN : les routes existantes font des
-- `select("*")` sur `candidates` (liste des candidats, délibérations…). Une
-- colonne image y ferait transiter plusieurs mégaoctets à chaque appel.
--
-- L'image est stockée en base64 plutôt que dans Supabase Storage : à l'échelle
-- d'un recrutement (~200 candidats × ~40 Ko après redimensionnement navigateur
-- en 512 px), cela pèse une dizaine de mégaoctets et évite d'avoir à créer et
-- sécuriser un bucket à la main. Le plafond est appliqué côté API
-- (frontend/src/lib/candidate-photo.ts, MAX_PHOTO_BYTES).
CREATE TABLE IF NOT EXISTS candidate_photos (
  candidate_id UUID PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  mime_type    TEXT        NOT NULL,
  data         TEXT        NOT NULL,          -- image encodée en base64 (sans préfixe data:)
  byte_size    INTEGER     NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- « candidate » si le candidat l'a déposée lui-même, sinon l'id du membre
  -- qui l'a téléversée à sa place (l'admin dépanne un candidat sans photo).
  updated_by   TEXT
);

ALTER TABLE candidate_photos ENABLE ROW LEVEL SECURITY;

-- ─── 2. Coups de cœur ───────────────────────────────────────────────────────
-- Une ligne = un cœur. Le quota de 5 est vérifié dans l'API, qui seule sait
-- lire l'état d'élimination (il vit dans `deliberations`, pas ici).
CREATE TABLE IF NOT EXISTS candidate_favorites (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id    UUID NOT NULL REFERENCES members(id)    ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un membre n'a qu'un seul cœur par candidat (pas de note en 5 cœurs :
-- 5 candidats maximum, un cœur chacun).
CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_favorites_member_candidate
  ON candidate_favorites (member_id, candidate_id);

-- Lecture « qui a mis un cœur à ce candidat ? » pendant la délibération.
CREATE INDEX IF NOT EXISTS idx_candidate_favorites_candidate
  ON candidate_favorites (candidate_id);

ALTER TABLE candidate_favorites ENABLE ROW LEVEL SECURITY;

-- ─── 3. Contrôle ────────────────────────────────────────────────────────────
-- Doit renvoyer 2 lignes, toutes deux avec rls = true.
SELECT c.relname, c.relrowsecurity AS rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('candidate_photos', 'candidate_favorites');
