-- ============================================
-- Migration: relance automatique des vœux de pôle
-- ============================================
-- Date du dernier mail de relance envoyé au candidat. Sans cette colonne la
-- route cron REFUSE d'envoyer (elle relancerait tout le monde chaque jour).
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS wishes_reminded_at TIMESTAMPTZ;
