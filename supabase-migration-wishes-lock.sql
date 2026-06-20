-- ============================================
-- Migration: verrou définitif des vœux de pôle (Tour 3)
-- ============================================
-- Une fois que le candidat confirme ses choix de pôles au Tour 3, le
-- classement devient DÉFINITIF : il ne peut plus revenir dessus. On
-- enregistre l'instant de verrouillage. NULL = pas encore verrouillé
-- (le candidat peut encore modifier, typiquement au Tour 2).
--
-- À copier dans le SQL Editor de Supabase.
-- ============================================

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS wishes_locked_at TIMESTAMPTZ;
