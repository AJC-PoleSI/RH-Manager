-- ------------------------------------------------------------
-- 07/10/2026 — notation du Tour 3 (brief de Felix du 06/10/2026, F3 et F4)
-- ------------------------------------------------------------
-- Migration ADDITIVE uniquement : colonnes nullables et table nouvelle.
-- Aucune donnée existante n'est modifiée ; une colonne vide (null) donne
-- exactement le comportement d'avant (Tours 1 et 2 inchangés).
--
-- F3 — Banque de questions de l'échange groupé :
--   epreuves.problem_bank : { criterionIndex, maxPoints, questions[] }
--     (cf. frontend/src/lib/problem-bank.ts) ; null = pas de banque.
--   slot_questions : la question choisie pour un créneau, partagée par ses
--     examinateurs (une ligne par créneau).
--   candidate_evaluations.problem_checks : pistes cochées par l'examinateur
--     (traçabilité ; la note elle-même reste dans `scores`).
-- F4 — Grille de groupe par épreuve :
--   epreuves.group_grid : null = grille actuelle (43 points),
--     { "disabled": true } = pas d'évaluation du groupe,
--     { "title", "questions" } = grille propre à l'épreuve
--     (cf. frontend/src/lib/group-evaluation-criteria.ts).

ALTER TABLE epreuves
  ADD COLUMN IF NOT EXISTS problem_bank JSONB;

ALTER TABLE epreuves
  ADD COLUMN IF NOT EXISTS group_grid JSONB;

ALTER TABLE candidate_evaluations
  ADD COLUMN IF NOT EXISTS problem_checks JSONB;

CREATE TABLE IF NOT EXISTS slot_questions (
  slot_id UUID PRIMARY KEY REFERENCES evaluation_slots(id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  updated_by UUID REFERENCES members(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Même régime que les autres tables : RLS active sans politique, seul le
-- serveur (clé service role) lit et écrit.
ALTER TABLE slot_questions ENABLE ROW LEVEL SECURITY;

-- ─── Annulation ─────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS slot_questions;
-- ALTER TABLE candidate_evaluations DROP COLUMN IF EXISTS problem_checks;
-- ALTER TABLE epreuves DROP COLUMN IF EXISTS group_grid;
-- ALTER TABLE epreuves DROP COLUMN IF EXISTS problem_bank;
