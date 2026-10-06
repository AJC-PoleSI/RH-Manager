-- ------------------------------------------------------------
-- 06/10/2026 — épreuves en distanciel
-- ------------------------------------------------------------
-- Une épreuve en distanciel n'a PAS de créneau : le candidat s'inscrit
-- simplement sur l'application (deadline facultative = inscription_deadline
-- existante), l'admin voit qui s'est inscrit, les documents partent hors
-- application, et la notation se fait sur la grille de l'épreuve (admins +
-- membres du pôle pour une épreuve de pôle). Demandé par Felix le 06/10/2026,
-- premier cas : l'entretien de pôle Marketing du Tour 3.
--
-- Tant que la colonne manque, l'API traite toutes les épreuves comme en
-- présentiel (comportement actuel) : rien ne casse.

ALTER TABLE epreuves
  ADD COLUMN IF NOT EXISTS is_distanciel BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS epreuve_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  epreuve_id UUID NOT NULL REFERENCES epreuves(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (epreuve_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS epreuve_registrations_candidate_idx
  ON epreuve_registrations (candidate_id);

-- Même régime que les autres tables : RLS active sans politique, seul le
-- serveur (clé service role) lit et écrit.
ALTER TABLE epreuve_registrations ENABLE ROW LEVEL SECURITY;

-- ─── Annulation ─────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS epreuve_registrations;
-- ALTER TABLE epreuves DROP COLUMN IF EXISTS is_distanciel;
