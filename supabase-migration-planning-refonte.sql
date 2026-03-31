-- ═══════════════════════════════════════════════════════════════
-- MIGRATION : Refonte Planning — Phases 1-3
-- Ajout des champs de configuration épreuve manquants
-- ═══════════════════════════════════════════════════════════════

-- Champ : roulement_minutes (temps de pause entre épreuves)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'epreuves' AND column_name = 'roulement_minutes'
    ) THEN
        ALTER TABLE epreuves ADD COLUMN roulement_minutes INTEGER DEFAULT 10;
    END IF;
END $$;

-- Champ : nb_salles (nombre de salles disponibles pour cette épreuve)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'epreuves' AND column_name = 'nb_salles'
    ) THEN
        ALTER TABLE epreuves ADD COLUMN nb_salles INTEGER DEFAULT 1;
    END IF;
END $$;

-- Champ : min_evaluators_per_salle (nombre minimum d'évaluateurs par salle)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'epreuves' AND column_name = 'min_evaluators_per_salle'
    ) THEN
        ALTER TABLE epreuves ADD COLUMN min_evaluators_per_salle INTEGER DEFAULT 2;
    END IF;
END $$;

-- Champ : date_debut (date de début de la période d'épreuve)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'epreuves' AND column_name = 'date_debut'
    ) THEN
        ALTER TABLE epreuves ADD COLUMN date_debut TEXT;
    END IF;
END $$;

-- Champ : date_fin (date de fin de la période d'épreuve)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'epreuves' AND column_name = 'date_fin'
    ) THEN
        ALTER TABLE epreuves ADD COLUMN date_fin TEXT;
    END IF;
END $$;
