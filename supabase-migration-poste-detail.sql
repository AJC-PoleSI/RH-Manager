-- ============================================
-- Migration: poste précis sur les vœux (bureau / trésorerie)
-- ============================================
-- En plus de wants_bureau (case "intéressé par un poste au bureau" sur
-- Développement commercial et Audit Qualité), on stocke le poste précis
-- choisi par le candidat :
--   • Dev Co / Audit Qualité + option bureau → "VP" / "Président" /
--     "Secrétaire générale"
--   • Trésorerie → "Trésorier/trésorière" / "Vice Trésorier/trésorière" /
--     "Coordinateur trésorerie"
--
-- À copier dans le SQL Editor de Supabase.
-- ============================================

ALTER TABLE candidate_wishes
  ADD COLUMN IF NOT EXISTS poste_detail TEXT;
