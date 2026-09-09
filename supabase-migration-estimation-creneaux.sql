-- ============================================================
-- Estimation du nombre de créneaux nécessaires (septembre 2026)
-- ============================================================
-- L'admin saisit un nombre de candidats attendus par épreuve ; le système en
-- déduit le nombre de créneaux à ouvrir (avec une marge de choix, car les
-- candidats s'inscrivent eux-mêmes une fois les créneaux publiés).
--
-- Purement indicatif : ces colonnes ne créent ni ne suppriment aucun
-- créneau. Elles alimentent un affichage à côté de la grille d'ouvertures
-- de salles (RoomOpeningsGrid).
--
-- Idempotent : ré-exécuter ce fichier ne casse rien.
-- ============================================================

ALTER TABLE public.epreuves
  ADD COLUMN IF NOT EXISTS candidats_attendus INTEGER,
  ADD COLUMN IF NOT EXISTS marge_pct INTEGER NOT NULL DEFAULT 25;

COMMENT ON COLUMN public.epreuves.candidats_attendus IS
  'Nombre de candidats attendus sur cette épreuve, saisi par l''admin. NULL = estimation non applicable.';
COMMENT ON COLUMN public.epreuves.marge_pct IS
  'Marge de choix (%) appliquée au calcul du nombre de créneaux nécessaires. Défaut 25.';
