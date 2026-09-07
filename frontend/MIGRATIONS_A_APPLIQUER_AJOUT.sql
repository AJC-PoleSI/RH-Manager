
-- ════════════════════════════════════════════════════════════════════
-- Dispatch : affectations manuelles protégées du rebrassage (07/09/2026)
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE slot_member_assignments
  ADD COLUMN IF NOT EXISTS is_manual boolean NOT NULL DEFAULT false;

-- ════════════════════════════════════════════════════════════════════
-- Intégration Be Fast (à ajouter si absente — voir audit du 07/09/2026 :
-- ce fichier n'était PAS repris dans MIGRATIONS_A_APPLIQUER.sql, seule
-- migration en attente dans ce cas, donc la plus exposée à l'oubli).
-- Contenu de supabase-migration-befast-integration.sql à la racine du dépôt.
-- ════════════════════════════════════════════════════════════════════
