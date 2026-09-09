-- ============================================================
-- Estimation par TOUR (septembre 2026)
-- ============================================================
-- « candidats attendus » remonte du niveau épreuve au niveau tour : les
-- épreuves d'un même tour (ex. Tour 1 = Entretien individuel + Business Game)
-- partagent le même effectif de candidats, donc le même chiffre. Fini de le
-- ressaisir pour chaque épreuve.
--
-- epreuves.candidats_attendus / marge_pct restent en base (migration
-- précédente) mais ne sont plus alimentés par le formulaire — colonnes
-- mortes, à retirer une fois ce système validé.
--
-- Idempotent : ré-exécuter ce fichier ne casse rien.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tour_settings (
  tour INTEGER PRIMARY KEY,
  candidats_attendus INTEGER,
  marge_pct INTEGER NOT NULL DEFAULT 25
);

COMMENT ON TABLE public.tour_settings IS
  'Effectif de candidats attendus par tour, partagé par toutes les épreuves de ce tour.';
