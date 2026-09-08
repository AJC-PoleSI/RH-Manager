-- ============================================================
-- Dispos simultanées : l'examinateur coche, l'algorithme tranche
-- (septembre 2026)
-- ============================================================
-- Un examinateur peut désormais se déclarer disponible sur DEUX épreuves qui
-- tombent au même moment. Se déclarer disponible n'est plus s'engager : c'est
-- le dispatch qui choisit, en privilégiant l'épreuve qui risque le plus de ne
-- pas pouvoir faire passer tous ses candidats.
--
-- Idempotent : ré-exécuter ce fichier ne casse rien.
-- ============================================================

-- ------------------------------------------------------------
-- 1) La disponibilité mémorise l'épreuve pour laquelle elle a été cochée
-- ------------------------------------------------------------
-- Sans cette colonne, une dispo est purement horaire : cocher « entretien
-- individuel 14h–15h » rendait aussi disponible pour un « business game
-- 14h30–15h30 » qu'on n'avait PAS coché.
--
-- Règle appliquée par le code (lib/dispatch-core.ts, availabilityMatchesSlot) :
--   • horaires strictement identiques  → la dispo vaut pour toutes les
--     épreuves de ce créneau (c'est au dispatch d'arbitrer) ;
--   • horaires partiellement superposés → il faut la bonne épreuve.
--
-- NULL = dispo héritée (grille hebdomadaire, données antérieures) : le
-- comportement historique par chevauchement est conservé.

ALTER TABLE public.availabilities
  ADD COLUMN IF NOT EXISTS epreuve_id UUID REFERENCES public.epreuves(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_availability_epreuve
  ON public.availabilities (epreuve_id);


-- ------------------------------------------------------------
-- 2) Provenance d'une inscription en liste d'attente
-- ------------------------------------------------------------
-- Quand un examinateur a coché deux épreuves simultanées, le dispatch le place
-- sur l'une et l'inscrit en LISTE D'ATTENTE sur l'autre : si un titulaire se
-- désiste et que son horaire s'est libéré, il peut être promu automatiquement
-- (/api/slots/toggle-member).
--
-- `source` distingue ces lignes de celles qu'un membre s'est ajoutées lui-même
-- (bouton « je suis disponible »). Le dispatch ne supprime QUE les siennes —
-- sans cette colonne, il ne touche à rien du tout, par sécurité.

ALTER TABLE public.slot_availability_requests
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'member';

CREATE INDEX IF NOT EXISTS idx_slot_requests_source
  ON public.slot_availability_requests (source);
