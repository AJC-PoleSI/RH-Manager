-- ------------------------------------------------------------
-- 07/10/2026 — coefficient choisi d'une épreuve (onglet « Coefficients »)
-- ------------------------------------------------------------
-- Jusqu'ici, le poids d'une épreuve dans la moyenne d'un candidat découlait
-- uniquement de son barème : total de la grille ÷ 20 (une épreuve /40 pèse 2,
-- une épreuve /5 pèse 0,25 — cf. getEpreuveCoefficient). Pour le Tour 3,
-- Felix veut pouvoir fixer ce poids à la main, épreuve par épreuve, depuis
-- Réglages → Coefficients.
--
-- Colonne NULLABLE, sans valeur par défaut : NULL = « automatique », c'est-à-
-- dire exactement le calcul d'aujourd'hui. Les épreuves existantes restent
-- donc à NULL et aucune moyenne ne bouge à l'application de la migration
-- (les tours 1 et 2, qui ont de vraies notes, sont en plus verrouillés côté
-- API : on ne peut pas changer le coefficient d'une épreuve d'un tour
-- terminé).
--
-- Tant que la colonne manque, l'application continue en mode automatique :
-- les moyennes sont calculées comme avant et l'enregistrement d'un
-- coefficient répond « migration à appliquer ». Rien ne casse.

ALTER TABLE epreuves
  ADD COLUMN IF NOT EXISTS coefficient NUMERIC;

-- ─── Annulation ─────────────────────────────────────────────────────────────
-- ALTER TABLE epreuves DROP COLUMN IF EXISTS coefficient;
