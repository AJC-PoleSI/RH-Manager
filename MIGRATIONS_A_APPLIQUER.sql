-- ============================================================
-- MIGRATIONS À APPLIQUER — RH Manager
-- ============================================================
-- Copier/coller l'intégralité de ce fichier dans le SQL Editor de Supabase,
-- puis exécuter. Tout est idempotent (IF NOT EXISTS) : ré-exécuter ne casse
-- rien. Supprime une section une fois qu'elle est appliquée, ou laisse —
-- la ré-exécution est sans effet.
--
-- Ordre indifférent entre les sections (elles sont indépendantes).
-- ============================================================


-- ------------------------------------------------------------
-- 1) Verrou définitif des vœux de pôle (Tour 3)
--    (supabase-migration-wishes-lock.sql)
-- ------------------------------------------------------------
-- Une fois que le candidat confirme ses choix de pôles au Tour 3, le
-- classement devient DÉFINITIF : il ne peut plus revenir dessus.
-- NULL = pas encore verrouillé (modifiable, typiquement au Tour 2).

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS wishes_locked_at TIMESTAMPTZ;


-- ------------------------------------------------------------
-- 2) Vœux de pôle horodatés par TOUR
--    (supabase-migration-wishes-tour.sql)
-- ------------------------------------------------------------
-- Distingue les vœux PROVISOIRES (Tour 2, dimensionnement du Tour 3) des
-- vœux DÉFINITIFS (Tour 3). Les lignes existantes deviennent des vœux de
-- Tour 2 (DEFAULT 2).

ALTER TABLE candidate_wishes
  ADD COLUMN IF NOT EXISTS tour INTEGER NOT NULL DEFAULT 2;

-- Un candidat a au plus un classement par (pôle, tour).
CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_wishes_candidate_pole_tour
  ON candidate_wishes (candidate_id, pole, tour);


-- ============================================================
-- FIN
-- ============================================================
