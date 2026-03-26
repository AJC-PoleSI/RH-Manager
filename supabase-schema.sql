-- ============================================
-- STEP 1: Run this FIRST to clean up old indexes
-- ============================================
DO $$
BEGIN
  EXECUTE 'DROP INDEX IF EXISTS idx_candidates_email';
  EXECUTE 'DROP INDEX IF EXISTS idx_candidates_name';
  EXECUTE 'DROP INDEX IF EXISTS idx_members_email';
  EXECUTE 'DROP INDEX IF EXISTS idx_evaluations_candidate';
  EXECUTE 'DROP INDEX IF EXISTS idx_evaluations_epreuve';
  EXECUTE 'DROP INDEX IF EXISTS idx_evaluations_member';
  EXECUTE 'DROP INDEX IF EXISTS idx_deliberations_candidate';
  EXECUTE 'DROP INDEX IF EXISTS idx_tracking_member';
  EXECUTE 'DROP INDEX IF EXISTS idx_tracking_candidate';
  EXECUTE 'DROP INDEX IF EXISTS idx_availability_member';
  EXECUTE 'DROP INDEX IF EXISTS idx_events_epreuve';
  EXECUTE 'DROP INDEX IF EXISTS idx_events_member';
  EXECUTE 'DROP INDEX IF EXISTS idx_events_candidate';
  EXECUTE 'DROP INDEX IF EXISTS idx_events_day';
  EXECUTE 'DROP INDEX IF EXISTS idx_wishes_candidate';
  EXECUTE 'DROP INDEX IF EXISTS idx_slots_epreuve';
  EXECUTE 'DROP INDEX IF EXISTS idx_slots_date';
  EXECUTE 'DROP INDEX IF EXISTS idx_slots_status';
  EXECUTE 'DROP INDEX IF EXISTS idx_slot_requests_member';
  EXECUTE 'DROP INDEX IF EXISTS idx_slot_assignments_member';
  EXECUTE 'DROP INDEX IF EXISTS idx_enrollments_candidate';
  EXECUTE 'DROP INDEX IF EXISTS idx_enrollments_slot';
END $$;
