-- ════════════════════════════════════════════════════════════════════════
-- Migration : intégration Befast ↔ RH Manager (côté RH — projet ynckz…)
-- À appliquer manuellement dans le SQL Editor Supabase du projet RH Manager.
-- Ajoute les colonnes de liaison + le miroir des documents poussés par Befast.
-- Idempotent (IF NOT EXISTS).
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS befast_person_id uuid,
  -- provenance : 'onboarding' (hub), 'rh_direct', 'befast_direct', 'backfill'
  ADD COLUMN IF NOT EXISTS onboarding_source text,
  -- payload curé des documents poussés par Befast (références, pas les fichiers)
  ADD COLUMN IF NOT EXISTS befast_documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS befast_documents_complete boolean NOT NULL DEFAULT false;

-- Un candidat RH est lié à au plus une personne Befast.
CREATE UNIQUE INDEX IF NOT EXISTS candidates_befast_person_id_key
  ON public.candidates (befast_person_id)
  WHERE befast_person_id IS NOT NULL;

-- Recherche par email déjà unique côté candidates (email = clé de liaison).
