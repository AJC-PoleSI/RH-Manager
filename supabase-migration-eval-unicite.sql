-- ============================================================
-- Unicité des évaluations de candidat  (16/09/2026)
-- ============================================================
--
-- POURQUOI : `POST /api/evaluations` vérifie l'absence de doublon en LISANT
-- avant d'écrire. Deux requêtes simultanées (double clic sur « Enregistrer »)
-- passent donc toutes les deux la vérification. C'est arrivé le 15/09 à 18:02 :
-- deux lignes identiques pour le même candidat, le même examinateur et la même
-- épreuve, à 1,2 seconde d'intervalle. Rien en base ne l'empêchait — aucun
-- index unique n'existait sur candidate_evaluations.
--
-- Le code rattrape déjà l'erreur 23505 (il relit la ligne gagnante et répond
-- « déjà évalué ») : ces index sont le verrou qui manquait pour la déclencher.
--
-- 1) On supprime les doublons existants (on garde la PLUS ANCIENNE ligne).
-- 2) On pose les deux index uniques partiels.

BEGIN;

-- ── 1) Doublons d'avis INDIVIDUELS (candidat, épreuve, examinateur) ──
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY candidate_id, epreuve_id, member_id
           ORDER BY created_at, id
         ) AS rn
  FROM candidate_evaluations
  WHERE is_group IS NOT TRUE
),
doublons AS (SELECT id FROM ranked WHERE rn > 1)
DELETE FROM evaluator_tracking WHERE evaluation_id IN (SELECT id FROM doublons);

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY candidate_id, epreuve_id, member_id
           ORDER BY created_at, id
         ) AS rn
  FROM candidate_evaluations
  WHERE is_group IS NOT TRUE
)
DELETE FROM candidate_evaluations WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ── 2) Doublons de notes PARTAGÉES (candidat, épreuve) ──
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY candidate_id, epreuve_id
           ORDER BY created_at, id
         ) AS rn
  FROM candidate_evaluations
  WHERE is_group IS TRUE
),
doublons AS (SELECT id FROM ranked WHERE rn > 1)
DELETE FROM evaluator_tracking WHERE evaluation_id IN (SELECT id FROM doublons);

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY candidate_id, epreuve_id
           ORDER BY created_at, id
         ) AS rn
  FROM candidate_evaluations
  WHERE is_group IS TRUE
)
DELETE FROM candidate_evaluations WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ── 3) Les verrous ──
-- Un avis individuel par (candidat, épreuve, examinateur).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_eval_individuelle
  ON candidate_evaluations (candidate_id, epreuve_id, member_id)
  WHERE is_group IS NOT TRUE;

-- Une seule note partagée (binôme) par (candidat, épreuve) : c'est déjà ce que
-- le code promet en renvoyant GROUP_EVAL_EXISTS.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_eval_partagee
  ON candidate_evaluations (candidate_id, epreuve_id)
  WHERE is_group IS TRUE;

COMMIT;
