-- ============================================
-- Migration: épreuve sur table bloquante (10/10/2026)
-- ============================================
-- Pour l'an prochain : une épreuve sur table (type commune) peut bloquer
-- TOUS les autres entretiens pendant qu'elle se tient — toutes épreuves,
-- tous pôles, sans exception (cf. frontend/src/lib/epreuve-bloquante.ts).
--   NULL       → désactivé (défaut, comportement actuel)
--   'pendant'  → de heure_debut à heure_debut + duration_minutes
--   'journee'  → toute la journée de date_debut
-- Additive : sans elle, l'option reste simplement invisible côté serveur.
--
-- À copier dans le SQL Editor de Supabase.
-- ============================================

ALTER TABLE epreuves ADD COLUMN IF NOT EXISTS blocage_autres_epreuves TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'epreuves_blocage_autres_epreuves_check'
  ) THEN
    ALTER TABLE epreuves
      ADD CONSTRAINT epreuves_blocage_autres_epreuves_check
      CHECK (blocage_autres_epreuves IS NULL OR blocage_autres_epreuves IN ('pendant', 'journee'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
