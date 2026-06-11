-- ============================================
-- Migration: épreuves sur table (commune) — date/heure/salle
-- ============================================
-- Le formulaire de création d'épreuve "sur table" collecte une heure de
-- convocation, une salle et un présentateur — jamais persistés jusqu'ici.
-- Les candidats peuvent désormais voir la date ET l'heure de convocation.
--
-- À copier dans le SQL Editor de Supabase.
-- ============================================

ALTER TABLE epreuves ADD COLUMN IF NOT EXISTS heure_debut TEXT;
ALTER TABLE epreuves ADD COLUMN IF NOT EXISTS salle TEXT;
ALTER TABLE epreuves ADD COLUMN IF NOT EXISTS presented_by TEXT;
