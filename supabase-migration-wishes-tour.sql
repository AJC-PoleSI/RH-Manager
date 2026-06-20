-- ============================================
-- Migration: vœux de pôle horodatés par TOUR
-- ============================================
-- On distingue désormais les vœux faits au Tour 2 (provisoires, servent à
-- dimensionner le nombre d'épreuves du Tour 3) des vœux confirmés au Tour 3
-- (définitifs). Chaque ligne de vœu porte le numéro du tour où elle a été
-- enregistrée. Les lignes existantes sont considérées comme des vœux de
-- Tour 2 (provisoires).
--
-- À copier dans le SQL Editor de Supabase.
-- ============================================

ALTER TABLE candidate_wishes
  ADD COLUMN IF NOT EXISTS tour INTEGER NOT NULL DEFAULT 2;

-- Un candidat a au plus un classement par (tour) : éviter les doublons de
-- (candidat, pôle, tour).
CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_wishes_candidate_pole_tour
  ON candidate_wishes (candidate_id, pole, tour);
