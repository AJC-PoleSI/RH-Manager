-- ════════════════════════════════════════════════════════════════════════════
-- ÉVALUATION DU GROUPE (business games) — 15/09/2026
--
-- AVANT : une épreuve de groupe portait, par candidat, une « note collective »
--   partagée (candidate_evaluations.is_group = true) co-éditée en temps réel
--   par tous les examinateurs du créneau, sur les mêmes critères que l'avis
--   individuel — et elle comptait dans la moyenne du candidat.
--
-- APRÈS : un seul examinateur du créneau (le dernier) note LE GROUPE sur une
--   grille dédiée de 9 critères (8 × 5 pts + bonus/malus 3 pts = 43). La note
--   porte sur le CRÉNEAU, pas sur un candidat, et sert d'éclairage en
--   délibération : elle n'entre pas dans la moyenne.
--
-- Une seule ligne par créneau : le premier examinateur qui saisit verrouille
-- la grille, les autres la voient en lecture seule (unique index ci-dessous).
-- Les anciennes lignes is_group des épreuves de groupe sont CONSERVÉES (leurs
-- commentaires ont de la valeur) mais l'application les écarte du calcul des
-- moyennes — cf. lib/group-evaluation-criteria.ts, isLegacyCollectiveNote().
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS group_evaluations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slot_id     UUID NOT NULL REFERENCES evaluation_slots(id) ON DELETE CASCADE,
  epreuve_id  UUID NOT NULL REFERENCES epreuves(id) ON DELETE CASCADE,
  -- Examinateur qui a pris la grille en main (le premier à saisir).
  member_id   UUID REFERENCES members(id) ON DELETE SET NULL,
  scores      JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Une seule évaluation de groupe par créneau — c'est ce qui sert de verrou
-- « premier arrivé » entre deux examinateurs qui ouvriraient la grille en
-- même temps (la 2e insertion échoue en 23505, l'appli bascule en lecture).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_group_evaluations_slot
  ON group_evaluations (slot_id);

CREATE INDEX IF NOT EXISTS idx_group_evaluations_epreuve
  ON group_evaluations (epreuve_id);

-- RLS : même régime que le reste du schéma (cf. supabase-migration-rls-lockdown).
-- L'application n'utilise que la clé service_role, qui ignore les policies ;
-- activer la RLS sans policy ferme simplement la table à anon/authenticated.
ALTER TABLE group_evaluations ENABLE ROW LEVEL SECURITY;

-- ─── Annulation ─────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS group_evaluations;
