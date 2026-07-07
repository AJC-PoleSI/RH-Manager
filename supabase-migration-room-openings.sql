-- Migration : ouvertures de salles (refonte création de créneaux)
-- À appliquer manuellement dans Supabase (SQL Editor).
-- Voir docs/superpowers/specs/2026-07-07-creation-creneaux-ouvertures-design.md

create table if not exists room_openings (
  id uuid primary key default gen_random_uuid(),
  epreuve_id uuid not null references epreuves(id) on delete cascade,
  room text not null,
  date date not null,
  start_time text not null,
  end_time text not null,
  break_start text,
  break_end text,
  created_at timestamptz default now()
);

alter table evaluation_slots
  add column if not exists opening_id uuid references room_openings(id) on delete set null;

create index if not exists idx_room_openings_epreuve on room_openings(epreuve_id);
create index if not exists idx_evaluation_slots_opening on evaluation_slots(opening_id);
