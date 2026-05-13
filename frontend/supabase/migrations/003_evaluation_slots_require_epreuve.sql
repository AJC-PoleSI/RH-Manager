-- ============================================================================
-- Migration 003 : evaluation_slots.epreuve_id must be NOT NULL
--
-- CONTEXT
--   Une régression côté API (/api/slots POST) permettait `epreuve_id: null`.
--   Résultat : 10 créneaux fantômes orphelins gonflaient le KPI
--   "Créneaux planifiés" alors qu'aucun créneau n'avait été créé volontairement.
--
-- CETTE MIGRATION
--   1. Supprime les éventuels orphelins restants (sans épreuve liée).
--   2. Pose une contrainte NOT NULL au niveau base : impossible de réintroduire
--      le bug même si un nouveau endpoint oublie de valider epreuve_id.
-- ============================================================================

-- 1) Nettoyer toute donnée orpheline restante
DELETE FROM evaluation_slots
WHERE epreuve_id IS NULL;

-- 2) Verrouiller au niveau schéma
ALTER TABLE evaluation_slots
  ALTER COLUMN epreuve_id SET NOT NULL;
