-- ============================================================
-- Migration: Système d'allocation intelligente des évaluateurs
-- ============================================================

-- 1. Colonnes workflow sur epreuves
ALTER TABLE epreuves
  ADD COLUMN IF NOT EXISTS workflow_status TEXT DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS heure_debut_journee TEXT DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS heure_fin_journee TEXT DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS salles_names JSONB DEFAULT '[]';

-- 2. ordre sur evaluation_slots (pour l'affichage)
ALTER TABLE evaluation_slots
  ADD COLUMN IF NOT EXISTS ordre INTEGER DEFAULT 0;

-- 3. Table allocations évaluateurs (résultat de l'algo)
CREATE TABLE IF NOT EXISTS evaluator_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  epreuve_id UUID NOT NULL REFERENCES epreuves(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES evaluation_slots(id) ON DELETE CASCADE,
  rang_priorite INTEGER NOT NULL,
  score_priorite FLOAT DEFAULT 0,
  statut TEXT NOT NULL DEFAULT 'affecte',   -- 'affecte' | 'en_attente'
  modifie_par_admin BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(slot_id, member_id)
);

-- 4. Historique des allocations (audit trail)
CREATE TABLE IF NOT EXISTS allocation_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  epreuve_id UUID NOT NULL REFERENCES epreuves(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  allocations JSONB,
  statistiques JSONB,
  triggered_by TEXT DEFAULT 'allocation_initiale',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Index performances
CREATE INDEX IF NOT EXISTS idx_eval_alloc_epreuve  ON evaluator_allocations(epreuve_id);
CREATE INDEX IF NOT EXISTS idx_eval_alloc_slot      ON evaluator_allocations(slot_id);
CREATE INDEX IF NOT EXISTS idx_eval_alloc_member    ON evaluator_allocations(member_id);
CREATE INDEX IF NOT EXISTS idx_alloc_hist_epreuve   ON allocation_history(epreuve_id);
