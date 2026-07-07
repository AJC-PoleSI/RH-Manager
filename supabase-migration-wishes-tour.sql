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

-- BUG FIX (trouvé en test local) : les contraintes UNIQUE d'origine
-- (candidat_id, pole) et (candidat_id, rank) — posées avant l'existence de
-- la colonne `tour` — ne sont PAS remplacées automatiquement par l'ajout de
-- `tour`. Tant qu'elles restent actives, un candidat ne peut plus soumettre
-- ses vœux Tour 3 dès qu'il réutilise un pôle ou un rang déjà pris au
-- Tour 2 (le cas normal) : PUT /api/wishes/[candidateId] échoue en 500.
-- Il faut les retirer — la nouvelle contrainte (candidat_id, pole, tour)
-- ci-dessous les remplace correctement (elle inclut déjà le pôle).
ALTER TABLE candidate_wishes
  DROP CONSTRAINT IF EXISTS candidate_wishes_candidate_id_pole_key;
ALTER TABLE candidate_wishes
  DROP CONSTRAINT IF EXISTS candidate_wishes_candidate_id_rank_key;

-- Un candidat a au plus un classement par (tour) : éviter les doublons de
-- (candidat, pôle, tour).
CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_wishes_candidate_pole_tour
  ON candidate_wishes (candidate_id, pole, tour);

-- Remplace l'ancienne contrainte (candidat_id, rank) : un candidat a au plus
-- un vœu par rang, mais SEULEMENT au sein d'un même tour.
CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_wishes_candidate_rank_tour
  ON candidate_wishes (candidate_id, rank, tour);
