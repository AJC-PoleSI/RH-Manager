-- ============================================================
-- Réinitialisation / définition de mot de passe pour les membres
-- ============================================================
-- Ajoute le nécessaire pour :
--   • « Mot de passe oublié ? » (lien envoyé par email),
--   • l'envoi par un admin d'un lien de définition de mot de passe,
--   • l'obligation de choisir un nouveau mot de passe à la prochaine
--     connexion (must_change_password).
--
-- SÉCURITÉ : `password_reset_token` ne contient PAS le jeton envoyé par
-- email mais son empreinte SHA-256. Une fuite de la table ne permet donc
-- pas de rejouer les liens en circulation.
-- Idempotent : ré-exécuter ne casse rien.
-- ============================================================

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS password_reset_token TEXT,
  ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

-- Un jeton actif ne peut appartenir qu'à un seul membre.
CREATE UNIQUE INDEX IF NOT EXISTS uq_members_password_reset_token
  ON members (password_reset_token)
  WHERE password_reset_token IS NOT NULL;

-- ------------------------------------------------------------
-- OPTIONNEL — forcer TOUT LE MONDE à choisir son mot de passe
-- ------------------------------------------------------------
-- À exécuter si vous voulez que chaque membre soit obligé de définir un
-- nouveau mot de passe à sa prochaine connexion. Équivaut au bouton
-- « Forcer le changement pour tous » de l'écran Membres.
--
-- UPDATE members SET must_change_password = true;
