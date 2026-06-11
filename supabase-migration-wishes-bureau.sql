-- ============================================
-- Migration: option "Bureau" sur les vœux de pôle
-- ============================================
-- Pour les pôles "Développement commercial" et "Audit Qualité", un
-- candidat peut indiquer qu'il est aussi intéressé par un poste au
-- bureau (VP / Président / Secrétaire générale).
--
-- À copier dans le SQL Editor de Supabase.
-- ============================================

ALTER TABLE candidate_wishes
  ADD COLUMN IF NOT EXISTS wants_bureau BOOLEAN NOT NULL DEFAULT false;
