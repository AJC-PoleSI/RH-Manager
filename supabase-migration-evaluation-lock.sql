-- ============================================
-- Migration : verrouillage des évaluations + attribution binôme
-- ============================================
-- Objectif :
--   • Une évaluation à auteur unique (is_group=false — entretien classique,
--     ou avis individuel d'un membre sur une épreuve de groupe) se clôture
--     automatiquement dès sa soumission : seul un admin peut la rouvrir
--     (POST /api/evaluations/[id]/reopen).
--   • Sur une épreuve individuelle (pas "de groupe") dont le créneau du
--     candidat a 2 examinateurs assignés ou plus, une seule note partagée
--     est créée (is_group=true, comme les épreuves de groupe) — un seul
--     examinateur la saisit, elle reste modifiable jusqu'à ce que l'un des
--     deux la valide/clôture (POST /api/evaluations/[id]/close).
--   • L'évaluation partagée est attribuée à CHAQUE examinateur du créneau
--     (evaluator_tracking, désormais multi-lignes par évaluation), pas
--     seulement à celui qui a soumis.
-- ============================================

ALTER TABLE candidate_evaluations
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reopened_by UUID REFERENCES members(id) ON DELETE SET NULL;

-- evaluator_tracking passait d'UNE ligne par évaluation (contrainte
-- UNIQUE(evaluation_id)) à une ligne par (membre, évaluation) : nécessaire
-- pour attribuer une évaluation partagée (binôme ou collective) à chacun
-- des examinateurs du créneau, pas seulement au premier qui l'a soumise.
ALTER TABLE evaluator_tracking
  DROP CONSTRAINT IF EXISTS evaluator_tracking_evaluation_id_key;

ALTER TABLE evaluator_tracking
  DROP CONSTRAINT IF EXISTS uniq_evaluator_tracking_member_evaluation;

ALTER TABLE evaluator_tracking
  ADD CONSTRAINT uniq_evaluator_tracking_member_evaluation
  UNIQUE (member_id, evaluation_id);
