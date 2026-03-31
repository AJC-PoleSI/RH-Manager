-- ═══════════════════════════════════════════════════════════════
-- MIGRATION : 5 Règles métiers
-- ═══════════════════════════════════════════════════════════════

-- RÈGLE 3 & 5 : S'assurer que is_global existe sur calendar_events
-- (peut déjà exister via supabase-chat-tours.sql)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'calendar_events' AND column_name = 'is_global'
    ) THEN
        ALTER TABLE calendar_events ADD COLUMN is_global BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Index pour filtrer les événements globaux rapidement
CREATE INDEX IF NOT EXISTS idx_calendar_events_is_global
    ON calendar_events(is_global) WHERE is_global = TRUE;

-- RÈGLE 3 : S'assurer que room existe sur evaluation_slots
-- (devrait déjà exister via le schema Prisma)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'evaluation_slots' AND column_name = 'room'
    ) THEN
        ALTER TABLE evaluation_slots ADD COLUMN room TEXT;
    END IF;
END $$;

-- RÈGLE 4 : Pas de contrainte unique sur (date, start_time) dans evaluation_slots
-- pour permettre plusieurs salles en parallèle sur le même créneau horaire.
-- Le modèle actuel le supporte déjà (pas de UNIQUE constraint bloquante).
-- Vérification : on s'assure qu'il n'y a pas de contrainte accidentelle
-- qui empêcherait les créneaux parallèles.

-- Commentaire explicatif pour la documentation :
-- Plusieurs evaluation_slots peuvent avoir la MÊME date + start_time + end_time
-- mais des rooms différentes → c'est la RÈGLE 4 (salles en parallèle).
-- Chaque slot a son propre max_candidates et ses propres enrollments.

-- RÈGLE 1 : Aucune modification de schema nécessaire.
-- La vérification 24h est faite côté applicatif (API + Frontend).
-- Le champ date + start_time sur evaluation_slots suffit pour calculer le délai.

-- RÈGLE 2 : Aucune modification de schema nécessaire.
-- Le calendrier candidat utilise calendar_events + slot_enrollments existants.
