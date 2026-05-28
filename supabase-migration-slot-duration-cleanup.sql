-- ============================================
-- Cleanup: réaligner duration_minutes sur l'écart réel start → end
-- ============================================
-- Avant ce commit, /api/slots POST stockait duration_minutes =
-- epreuve.duration_minutes + 10 (buffer), tandis que end_time était
-- calculé à partir de la durée envoyée par le client. Résultat : le
-- créneau affichait "30min" alors qu'il durait 20min en réel.
--
-- Cette requête corrige les créneaux existants pour que
-- duration_minutes corresponde toujours à (end_time - start_time).
-- ============================================

UPDATE evaluation_slots
SET duration_minutes = GREATEST(
  1,
  (EXTRACT(EPOCH FROM (end_time::time - start_time::time)) / 60)::int
)
WHERE duration_minutes IS DISTINCT FROM
  GREATEST(1, (EXTRACT(EPOCH FROM (end_time::time - start_time::time)) / 60)::int);
