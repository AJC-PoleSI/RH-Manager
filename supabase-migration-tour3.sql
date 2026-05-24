-- ============================================
-- MIGRATION: SYSTEME D'INSCRIPTION TOUR 3
-- ============================================

-- 1. Add pole_affiliation to members
ALTER TABLE members ADD COLUMN IF NOT EXISTS pole_affiliation TEXT;

-- 2. Create tour3_slots
CREATE TABLE IF NOT EXISTS tour3_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pole TEXT NOT NULL,
  date_time TIMESTAMPTZ NOT NULL,
  examiner_id UUID REFERENCES members(id),
  status TEXT DEFAULT 'open',
  max_capacity INTEGER NOT NULL,
  enrolled_count INTEGER DEFAULT 0,
  created_by_admin BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Create tour3_candidate_places
CREATE TABLE IF NOT EXISTS tour3_candidate_places (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_slot_id UUID NOT NULL REFERENCES tour3_slots(id) ON DELETE CASCADE,
  pole TEXT NOT NULL,
  date_time TIMESTAMPTZ NOT NULL,
  candidate_id UUID REFERENCES candidates(id) ON DELETE SET NULL,
  examiner_id UUID REFERENCES members(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index pour accélérer les requêtes
CREATE INDEX IF NOT EXISTS idx_tour3_slots_pole ON tour3_slots(pole);
CREATE INDEX IF NOT EXISTS idx_tour3_places_slot ON tour3_candidate_places(parent_slot_id);
CREATE INDEX IF NOT EXISTS idx_tour3_places_candidate ON tour3_candidate_places(candidate_id);
CREATE INDEX IF NOT EXISTS idx_tour3_places_examiner ON tour3_candidate_places(examiner_id);

-- 4. trigger_create_candidate_places()
CREATE OR REPLACE FUNCTION trigger_create_candidate_places()
RETURNS TRIGGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Compter le nombre de candidats ayant demandé ce pôle dans leurs voeux
  SELECT COUNT(DISTINCT candidate_id) INTO v_count
  FROM candidate_wishes
  WHERE pole = NEW.pole;

  -- Créer les places orphelines (sans examinateur ni candidat)
  FOR i IN 1..v_count LOOP
    INSERT INTO tour3_candidate_places (parent_slot_id, pole, date_time, examiner_id, candidate_id)
    VALUES (NEW.id, NEW.pole, NEW.date_time, NULL, NULL);
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_create_candidate_places_for_slot ON tour3_slots;
CREATE TRIGGER trg_create_candidate_places_for_slot
AFTER INSERT ON tour3_slots
FOR EACH ROW
EXECUTE FUNCTION trigger_create_candidate_places();

-- 5. liberate_places_for_examiner()
CREATE OR REPLACE FUNCTION liberate_places_for_examiner(p_examiner_id UUID, p_slot_id UUID)
RETURNS VOID AS $$
DECLARE
  v_capacity INTEGER;
BEGIN
  -- Fetch max capacity of the slot
  SELECT max_capacity INTO v_capacity FROM tour3_slots WHERE id = p_slot_id;

  -- Assigner l'examinateur à (max_capacity) places orphelines pour ce créneau
  UPDATE tour3_candidate_places
  SET examiner_id = p_examiner_id
  WHERE id IN (
    SELECT id FROM tour3_candidate_places
    WHERE parent_slot_id = p_slot_id
      AND examiner_id IS NULL
    LIMIT v_capacity
  );
END;
$$ LANGUAGE plpgsql;

-- 6. enroll_candidate_to_slot()
CREATE OR REPLACE FUNCTION enroll_candidate_to_slot(p_candidate_id UUID, p_place_id UUID)
RETURNS VOID AS $$
DECLARE
  v_slot_id UUID;
BEGIN
  -- Vérifier si la place est bien disponible
  IF EXISTS (
    SELECT 1 FROM tour3_candidate_places
    WHERE id = p_place_id AND candidate_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cette place est déjà prise';
  END IF;

  UPDATE tour3_candidate_places
  SET candidate_id = p_candidate_id
  WHERE id = p_place_id
  RETURNING parent_slot_id INTO v_slot_id;

  IF v_slot_id IS NOT NULL THEN
    UPDATE tour3_slots
    SET enrolled_count = enrolled_count + 1
    WHERE id = v_slot_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 7. trigger_check_saturation_and_cascade()
CREATE OR REPLACE FUNCTION trigger_check_saturation_and_cascade()
RETURNS TRIGGER AS $$
DECLARE
  v_enrolled INTEGER;
  v_capacity INTEGER;
  v_slot_id UUID;
  v_pole TEXT;
  v_examiner_id UUID;
  v_orphan_place RECORD;
BEGIN
  -- Vérifier uniquement si un candidat a été ajouté
  IF NEW.candidate_id IS NOT NULL AND OLD.candidate_id IS NULL THEN
    v_slot_id := NEW.parent_slot_id;
    
    SELECT enrolled_count, max_capacity, pole INTO v_enrolled, v_capacity, v_pole
    FROM tour3_slots
    WHERE id = v_slot_id;

    IF v_enrolled >= v_capacity THEN
      -- Chercher les places orphelines du même pôle, non assignées à un examinateur
      FOR v_orphan_place IN 
        SELECT id FROM tour3_candidate_places
        WHERE pole = v_pole
          AND candidate_id IS NULL
          AND examiner_id IS NULL
      LOOP
        -- Chercher un examinateur disponible du même pôle (qui n'a pas atteint sa capacité)
        SELECT e.id INTO v_examiner_id
        FROM members e
        WHERE e.pole_affiliation = v_pole
          AND (
            SELECT COUNT(*) 
            FROM tour3_slots ts
            WHERE ts.examiner_id = e.id 
              AND ts.enrolled_count < ts.max_capacity
          ) > 0
        LIMIT 1;

        IF v_examiner_id IS NOT NULL THEN
          UPDATE tour3_candidate_places
          SET examiner_id = v_examiner_id
          WHERE id = v_orphan_place.id;
        END IF;
      END LOOP;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_saturation_cascade ON tour3_candidate_places;
CREATE TRIGGER trg_check_saturation_cascade
AFTER UPDATE OF candidate_id ON tour3_candidate_places
FOR EACH ROW
EXECUTE FUNCTION trigger_check_saturation_and_cascade();
