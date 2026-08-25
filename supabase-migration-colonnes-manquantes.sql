-- ============================================================
-- Migration : colonnes utilisées par le code mais absentes des migrations
-- ============================================================
-- Constat de l'audit du 25 août 2026.
--
-- Trois colonnes étaient lues ou écrites par l'application sans qu'aucun
-- fichier de migration du dépôt ne les crée. Elles avaient été ajoutées à la
-- main dans le SQL Editor de Supabase pour la production — donc invisibles
-- pour quiconque reconstruit la base depuis le dépôt (préprod, nouveau
-- développeur, reprise après incident), qui obtenait une application cassée
-- dès la création d'une épreuve.
--
--   • epreuves.color / epreuves.description
--       Écrites systématiquement par POST /api/epreuves. Présentes en
--       production, absentes du dépôt → création d'épreuve en 400
--       ("Could not find the 'color' column of 'epreuves'").
--
--   • deliberations.assigned_pole
--       Lue par GET /api/kpis/poles et GET /api/deliberations. Absente
--       PARTOUT, y compris en production → l'écran « KPI par pôle »
--       renvoyait 500 (code Postgres 42703).
--
-- Note : aucune route n'ÉCRIT encore assigned_pole. Le compteur
-- « places acceptées » de l'écran KPI restera donc à 0 tant que
-- l'affectation de pôle en délibération n'est pas implémentée. La colonne est
-- créée ici pour que la lecture cesse d'échouer.
--
-- À copier dans le SQL Editor de Supabase. Idempotent.
-- ============================================================

ALTER TABLE epreuves ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#3B82F6';
ALTER TABLE epreuves ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE deliberations ADD COLUMN IF NOT EXISTS assigned_pole TEXT;
