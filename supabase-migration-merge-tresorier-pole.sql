-- ============================================
-- Migration: fusion "Bureau - Trésorier" → "Trésorerie"
-- ============================================
-- "Bureau - Trésorier" n'est plus une option de pôle distincte : le/la
-- trésorier(ère) est élu(e) parmi les membres du pôle "Trésorerie".
-- Cette migration met à jour les données existantes en conséquence.
--
-- À copier dans le SQL Editor de Supabase.
-- ============================================

-- 1. Membres : pole = 'Bureau - Trésorier' → 'Trésorerie'
UPDATE members
SET pole = 'Trésorerie'
WHERE pole = 'Bureau - Trésorier';

-- 2. Vœux candidats : éviter le conflit UNIQUE(candidate_id, pole) si un
--    candidat a déjà un vœu "Trésorerie" en plus de "Bureau - Trésorier".
--    On supprime d'abord le doublon "Bureau - Trésorier" dans ce cas.
DELETE FROM candidate_wishes cw
WHERE cw.pole = 'Bureau - Trésorier'
  AND EXISTS (
    SELECT 1 FROM candidate_wishes cw2
    WHERE cw2.candidate_id = cw.candidate_id
      AND cw2.pole = 'Trésorerie'
  );

-- 3. Vœux candidats restants : 'Bureau - Trésorier' → 'Trésorerie'
UPDATE candidate_wishes
SET pole = 'Trésorerie'
WHERE pole = 'Bureau - Trésorier';

-- 4. Épreuves de pôle (au cas où une épreuve aurait été configurée sur
--    l'ancienne valeur)
UPDATE epreuves
SET pole = 'Trésorerie'
WHERE pole = 'Bureau - Trésorier';
