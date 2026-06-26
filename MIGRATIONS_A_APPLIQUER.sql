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


-- ------------------------------------------------------------
-- 3) Index de performance (additif, sans risque)
-- ------------------------------------------------------------
-- Le dispatch et les KPI font des lectures par date/heure et par slot/membre.
-- Ces index accélèrent les requêtes quand le volume grandit. 100% sûrs
-- (aucune validation de données, IF NOT EXISTS).

CREATE INDEX IF NOT EXISTS idx_availabilities_date_start
  ON availabilities (date, start_time);
CREATE INDEX IF NOT EXISTS idx_availabilities_member
  ON availabilities (member_id);

CREATE INDEX IF NOT EXISTS idx_sma_slot
  ON slot_member_assignments (slot_id);
CREATE INDEX IF NOT EXISTS idx_sma_member
  ON slot_member_assignments (member_id);

CREATE INDEX IF NOT EXISTS idx_slot_enrollments_slot
  ON slot_enrollments (slot_id);
CREATE INDEX IF NOT EXISTS idx_slot_enrollments_candidate
  ON slot_enrollments (candidate_id);

CREATE INDEX IF NOT EXISTS idx_candidate_wishes_candidate
  ON candidate_wishes (candidate_id);

CREATE INDEX IF NOT EXISTS idx_eval_slots_epreuve
  ON evaluation_slots (epreuve_id);
CREATE INDEX IF NOT EXISTS idx_eval_slots_date_start
  ON evaluation_slots (date, start_time);


-- ============================================================
-- FIN
-- ============================================================
