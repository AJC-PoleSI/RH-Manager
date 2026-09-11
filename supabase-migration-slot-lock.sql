-- ════════════════════════════════════════════════════════════════════
-- VERROUILLAGE DES CRÉNEAUX (septembre 2026)
-- ════════════════════════════════════════════════════════════════════
--
-- PROBLÈME
-- ────────
-- Le dispatch se relance à CHAQUE sauvegarde de disponibilité par un membre
-- (api/availability/route.ts), et rebrasse alors intégralement le jury de tout
-- créneau non protégé : l'étape 9c reconstruit la sélection à partir d'une
-- liste vide, les examinateurs en place n'ont aucune priorité. Un créneau
-- publié, annoncé aux examinateurs, pouvait donc changer entièrement de jury
-- parce qu'un membre a coché une case trois semaines plus tôt.
--
-- POURQUOI PAS LE STATUT
-- ──────────────────────
-- `status` est recalculé à chaque run à partir de l'effectif du jury
-- (slotStatusAfterDispatch) : "ready" veut seulement dire « jury complet », et
-- "published" dépend d'un interrupteur global valable pour TOUS les tours.
-- Verrouiller sur le statut figerait le planning entier dès le premier run et
-- déborderait sur le tour suivant. Le verrou doit être un acte explicite,
-- écrit au moment de la décision.
--
-- CE QUE LE VERROU PROTÈGE
-- ────────────────────────
--   - le jury (le dispatch ne rebrasse plus, il ne fait que compléter),
--   - l'identité du créneau : date, horaire, salle,
--   - les inscriptions candidats (plus de fusion/regroupement automatique).
-- Le `status` continue d'évoluer normalement.
--
-- MOTIFS (locked_reason) :
--   'publication' — planning de l'épreuve publié aux candidats
--   'inscription' — un candidat a réservé le créneau
--   'manuel'      — figé à la main par l'admin
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE evaluation_slots
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_reason TEXT;

-- Le dispatch filtre sur `is_locked` à chaque run, sur l'ensemble des
-- créneaux (> 1000 lignes en base) : l'index évite un seq scan par run.
CREATE INDEX IF NOT EXISTS idx_evaluation_slots_is_locked
  ON evaluation_slots (is_locked)
  WHERE is_locked = true;

-- ── Rattrapage de l'existant ────────────────────────────────────────
-- Les créneaux qui ont DÉJÀ des candidats inscrits sont verrouillés
-- rétroactivement : ce sont des rendez-vous pris, ils ne doivent pas attendre
-- une prochaine inscription pour être protégés.
UPDATE evaluation_slots s
   SET is_locked = true,
       locked_at = now(),
       locked_reason = 'inscription'
 WHERE s.is_locked = false
   AND EXISTS (
     SELECT 1 FROM slot_enrollments e
      WHERE e.slot_id = s.id
        AND coalesce(e.status, 'enrolled') <> 'cancelled'
   );

-- Les créneaux déjà publiés aux candidats le sont aussi : ils ont été
-- annoncés, ils ne doivent plus bouger.
UPDATE evaluation_slots
   SET is_locked = true,
       locked_at = now(),
       locked_reason = 'publication'
 WHERE is_locked = false
   AND status IN ('published', 'full');

-- Vérification (facultatif) :
--   SELECT locked_reason, count(*) FROM evaluation_slots
--    WHERE is_locked GROUP BY locked_reason;
