-- ============================================
-- SUPABASE SCHEMA FOR RH MANAGER
-- Run this in Supabase SQL Editor
-- Safe to re-run (all IF NOT EXISTS)
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CANDIDATES
CREATE TABLE IF NOT EXISTS candidates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  comments TEXT,
  password_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_candidates_email ON candidates(email);
CREATE INDEX IF NOT EXISTS idx_candidates_name ON candidates(last_name, first_name);

-- MEMBERS
CREATE TABLE IF NOT EXISTS members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_members_email ON members(email);

-- EPREUVES
CREATE TABLE IF NOT EXISTS epreuves (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  tour INTEGER NOT NULL,
  type TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  evaluation_questions TEXT NOT NULL DEFAULT '[]',
  is_pole_test BOOLEAN DEFAULT false,
  pole TEXT,
  is_group_epreuve BOOLEAN DEFAULT false,
  group_size INTEGER DEFAULT 1
);

-- CANDIDATE EVALUATIONS
CREATE TABLE IF NOT EXISTS candidate_evaluations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  epreuve_id UUID NOT NULL REFERENCES epreuves(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  scores TEXT NOT NULL DEFAULT '{}',
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evaluations_candidate ON candidate_evaluations(candidate_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_epreuve ON candidate_evaluations(epreuve_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_member ON candidate_evaluations(member_id);

-- DELIBERATIONS
CREATE TABLE IF NOT EXISTS deliberations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id UUID UNIQUE NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  tour1_status TEXT DEFAULT 'pending',
  tour2_status TEXT DEFAULT 'pending',
  tour3_status TEXT DEFAULT 'pending',
  global_comments TEXT,
  pros_comment TEXT,
  cons_comment TEXT
);
CREATE INDEX IF NOT EXISTS idx_deliberations_candidate ON deliberations(candidate_id);

-- EVALUATOR TRACKING
CREATE TABLE IF NOT EXISTS evaluator_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  evaluation_id UUID UNIQUE NOT NULL REFERENCES candidate_evaluations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tracking_member ON evaluator_tracking(member_id);
CREATE INDEX IF NOT EXISTS idx_tracking_candidate ON evaluator_tracking(candidate_id);

-- AVAILABILITY
CREATE TABLE IF NOT EXISTS availabilities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  weekday TEXT NOT NULL,
  date TIMESTAMPTZ,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_availability_member ON availabilities(member_id);

-- CALENDAR EVENTS
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  day TIMESTAMPTZ NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  related_epreuve_id UUID REFERENCES epreuves(id) ON DELETE SET NULL,
  related_member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  related_candidate_id UUID REFERENCES candidates(id) ON DELETE SET NULL,
  max_candidates INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_events_epreuve ON calendar_events(related_epreuve_id);
CREATE INDEX IF NOT EXISTS idx_events_member ON calendar_events(related_member_id);
CREATE INDEX IF NOT EXISTS idx_events_candidate ON calendar_events(related_candidate_id);
CREATE INDEX IF NOT EXISTS idx_events_day ON calendar_events(day);

-- SYSTEM SETTINGS
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- CANDIDATE WISHES
CREATE TABLE IF NOT EXISTS candidate_wishes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  pole TEXT NOT NULL,
  rank INTEGER NOT NULL,
  UNIQUE(candidate_id, pole),
  UNIQUE(candidate_id, rank)
);
CREATE INDEX IF NOT EXISTS idx_wishes_candidate ON candidate_wishes(candidate_id);

-- EVALUATION SLOTS
CREATE TABLE IF NOT EXISTS evaluation_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  epreuve_id UUID REFERENCES epreuves(id) ON DELETE SET NULL,
  date TIMESTAMPTZ NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  duration_minutes INTEGER DEFAULT 60,
  room TEXT,
  label TEXT,
  max_candidates INTEGER DEFAULT 1,
  min_members INTEGER DEFAULT 1,
  simultaneous_slots INTEGER DEFAULT 1,
  status TEXT DEFAULT 'open',
  tour INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_slots_epreuve ON evaluation_slots(epreuve_id);
CREATE INDEX IF NOT EXISTS idx_slots_date ON evaluation_slots(date);
CREATE INDEX IF NOT EXISTS idx_slots_status ON evaluation_slots(status);

-- SLOT AVAILABILITY REQUESTS
CREATE TABLE IF NOT EXISTS slot_availability_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slot_id UUID NOT NULL REFERENCES evaluation_slots(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(slot_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_slot_requests_member ON slot_availability_requests(member_id);

-- SLOT MEMBER ASSIGNMENTS
CREATE TABLE IF NOT EXISTS slot_member_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slot_id UUID NOT NULL REFERENCES evaluation_slots(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  UNIQUE(slot_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_slot_assignments_member ON slot_member_assignments(member_id);

-- SLOT ENROLLMENTS
CREATE TABLE IF NOT EXISTS slot_enrollments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slot_id UUID NOT NULL REFERENCES evaluation_slots(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'enrolled',
  enrolled_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(slot_id, candidate_id)
);
CREATE INDEX IF NOT EXISTS idx_enrollments_candidate ON slot_enrollments(candidate_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_slot ON slot_enrollments(slot_id);

-- SEED: Default admin member (password: admin123)
INSERT INTO members (email, password_hash, is_admin)
VALUES ('admin@ajc.fr', '$2a$10$8Kx6QXHQ7p1Zq3YGfY5X5eJ8v0oZ5q2Z1q3Y4G5H6J7K8L9M0N1O2', true)
ON CONFLICT (email) DO NOTHING;
