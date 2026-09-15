-- ════════════════════════════════════════════════════════════════════════════
-- LIEN DE BUSINESS GAME — un lien par créneau, réservé à son jury
-- ════════════════════════════════════════════════════════════════════════════
-- L'admin dépose sur chaque créneau de business game un lien (sujet, dossier
-- partagé, grille de notes…) que SEULS les examinateurs affectés à ce
-- créneau-là doivent pouvoir ouvrir. Ni les candidats, ni les examinateurs
-- des autres groupes.
--
-- POURQUOI UNE TABLE À PART ET PAS UNE COLONNE SUR `evaluation_slots`
-- ───────────────────────────────────────────────────────────────────
-- /api/slots/all fait un `select("*")` sur evaluation_slots et est ouverte à
-- TOUT le staff (elle refuse les candidats, pas les membres). Une colonne
-- `bg_link` y serait donc renvoyée à n'importe quel examinateur, y compris
-- ceux qui ne sont pas sur le créneau — précisément ce qu'on veut empêcher.
-- Le même raisonnement vaut pour toute route future qui ferait `select("*")`.
--
-- Une table séparée n'est jamais ramassée par un `select("*")` : le lien ne
-- peut sortir que par une jointure écrite exprès. L'étanchéité tient à la
-- structure, pas à la vigilance de la prochaine relecture.
--
-- Clé primaire sur slot_id : UN lien par créneau, remplacé par un upsert.
-- ON DELETE CASCADE : un créneau supprimé emporte son lien.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS slot_links (
  slot_id    UUID PRIMARY KEY REFERENCES evaluation_slots(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  label      TEXT,
  updated_by UUID REFERENCES members(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Le verrouillage RLS du 19/08/2026 (supabase-migration-rls-lockdown.sql) a
-- bouclé sur les tables existant CE JOUR-LÀ : une table créée après reste
-- ouverte à la clé anon si on ne l'active pas ici. L'applicatif ne parle à la
-- base qu'avec la clé service_role (BYPASSRLS), aucune policy n'est donc
-- nécessaire — l'absence de policy referme la table pour tout le reste.
ALTER TABLE slot_links ENABLE ROW LEVEL SECURITY;
