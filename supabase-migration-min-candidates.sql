-- Minimum de candidats pour les épreuves de groupe (business game)
-- Voir docs/superpowers/specs/2026-09-07-min-candidats-epreuves-groupe-design.md
--
-- Pour une épreuve de groupe, l'admin peut fixer un minimum de candidats par
-- créneau (en plus du maximum déjà existant via group_size). La règle
-- métier associée (min_evaluators_per_salle = min_candidates) est gérée par
-- l'application, pas par une contrainte SQL.

ALTER TABLE epreuves
  ADD COLUMN IF NOT EXISTS min_candidates INTEGER;

ALTER TABLE evaluation_slots
  ADD COLUMN IF NOT EXISTS min_candidates INTEGER;
