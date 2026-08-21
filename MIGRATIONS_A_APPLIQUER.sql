-- ============================================================
-- MIGRATIONS À APPLIQUER — RH Manager
-- ============================================================
-- Copier/coller l'intégralité de ce fichier dans le SQL Editor de Supabase,
-- puis exécuter. Tout est idempotent (IF NOT EXISTS) : ré-exécuter ne casse
-- rien. Supprime une section une fois qu'elle est appliquée, ou laisse —
-- la ré-exécution est sans effet.
--
-- Ordre indifférent entre les sections (elles sont indépendantes).
-- ============================================================


-- ------------------------------------------------------------
-- 1) Verrou définitif des vœux de pôle (Tour 3)
--    (supabase-migration-wishes-lock.sql)
-- ------------------------------------------------------------
-- Une fois que le candidat confirme ses choix de pôles au Tour 3, le
-- classement devient DÉFINITIF : il ne peut plus revenir dessus.
-- NULL = pas encore verrouillé (modifiable, typiquement au Tour 2).

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS wishes_locked_at TIMESTAMPTZ;


-- ------------------------------------------------------------
-- 2) Vœux de pôle horodatés par TOUR
--    (supabase-migration-wishes-tour.sql)
-- ------------------------------------------------------------
-- Distingue les vœux PROVISOIRES (Tour 2, dimensionnement du Tour 3) des
-- vœux DÉFINITIFS (Tour 3). Les lignes existantes deviennent des vœux de
-- Tour 2 (DEFAULT 2).

ALTER TABLE candidate_wishes
  ADD COLUMN IF NOT EXISTS tour INTEGER NOT NULL DEFAULT 2;

-- BUG FIX (trouvé en test local) : les contraintes UNIQUE d'origine
-- (candidat_id, pole) et (candidat_id, rank) — posées avant l'existence de
-- la colonne `tour` — bloquent la soumission des vœux Tour 3 dès qu'un
-- candidat réutilise un pôle ou un rang déjà pris au Tour 2 (le cas
-- normal) : PUT /api/wishes/[candidateId] échoue en 500. À retirer.
ALTER TABLE candidate_wishes
  DROP CONSTRAINT IF EXISTS candidate_wishes_candidate_id_pole_key;
ALTER TABLE candidate_wishes
  DROP CONSTRAINT IF EXISTS candidate_wishes_candidate_id_rank_key;

-- Un candidat a au plus un classement par (pôle, tour).
CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_wishes_candidate_pole_tour
  ON candidate_wishes (candidate_id, pole, tour);

-- Remplace l'ancienne contrainte (candidat_id, rank) : un candidat a au plus
-- un vœu par rang, mais SEULEMENT au sein d'un même tour.
CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_wishes_candidate_rank_tour
  ON candidate_wishes (candidate_id, rank, tour);


-- ------------------------------------------------------------
-- 3) Index de performance (additif, sans risque)
-- ------------------------------------------------------------
-- Le dispatch et les KPI font des lectures par date/heure et par slot/membre.
-- Ces index accélèrent les requêtes quand le volume grandit. 100% sûrs
-- (aucune validation de données, IF NOT EXISTS).

CREATE INDEX IF NOT EXISTS idx_availabilities_date_start
  ON availabilities (date, start_time);
CREATE INDEX IF NOT EXISTS idx_availabilities_member
  ON availabilities (member_id);

CREATE INDEX IF NOT EXISTS idx_sma_slot
  ON slot_member_assignments (slot_id);
CREATE INDEX IF NOT EXISTS idx_sma_member
  ON slot_member_assignments (member_id);

CREATE INDEX IF NOT EXISTS idx_slot_enrollments_slot
  ON slot_enrollments (slot_id);
CREATE INDEX IF NOT EXISTS idx_slot_enrollments_candidate
  ON slot_enrollments (candidate_id);

CREATE INDEX IF NOT EXISTS idx_candidate_wishes_candidate
  ON candidate_wishes (candidate_id);

CREATE INDEX IF NOT EXISTS idx_eval_slots_epreuve
  ON evaluation_slots (epreuve_id);
CREATE INDEX IF NOT EXISTS idx_eval_slots_date_start
  ON evaluation_slots (date, start_time);


-- ------------------------------------------------------------
-- 4) Écriture ATOMIQUE des affectations examinateurs (dispatch)
--    (supabase-migration-dispatch-atomic.sql)
-- ------------------------------------------------------------
-- Le dispatch supprime puis réinsère les affectations d'un lot de créneaux.
-- Sans transaction, un échec d'insert laissait des créneaux SANS jury. Cette
-- fonction fait delete + insert dans UNE transaction (rollback si échec).
-- Le code retombe sur l'ancien comportement tant qu'elle n'existe pas, donc
-- l'ordre déploiement/migration est indifférent. Idempotent (CREATE OR REPLACE).

create or replace function replace_slot_assignments(
  p_slot_ids uuid[],
  p_assignments jsonb
) returns void
language plpgsql
as $$
begin
  if p_slot_ids is not null and array_length(p_slot_ids, 1) is not null then
    delete from slot_member_assignments
      where slot_id = any (p_slot_ids);
  end if;

  if p_assignments is not null and jsonb_array_length(p_assignments) > 0 then
    insert into slot_member_assignments (slot_id, member_id)
    select (elem ->> 'slot_id')::uuid, (elem ->> 'member_id')::uuid
    from jsonb_array_elements(p_assignments) as elem;
  end if;
end;
$$;


-- ============================================================
-- FIN
-- ============================================================

-- ============================================================
-- 2026-07-07 : room_openings (ouvertures de salles)
-- ============================================================

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

-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ PRIORITAIRE — VERROUILLAGE RLS (audit sécurité du 19/08/2026, point #4)
--
-- La base est actuellement en LECTURE ET ÉCRITURE PUBLIQUES : avec la clé
-- anon, 22 tables sur 25 sont lisibles (dont members.password_hash) et les
-- PATCH/DELETE sur members et candidates renvoient HTTP 204. Autrement dit :
-- promotion admin et suppression de la base possibles sans authentification.
--
-- Le SQL complet, commenté, avec vérification et script d'annulation :
--     supabase-migration-rls-lockdown.sql
--
-- À appliquer EN PREMIER dans l'éditeur SQL Supabase. Ne casse pas l'app :
-- toutes les routes API passent par service_role, qui contourne la RLS.
-- ════════════════════════════════════════════════════════════════════════════


-- ============================================================
-- 2026-08-20 : nettoyage — epreuves.nb_salles devenu inutile
-- ============================================================
-- Les salles ne sont plus déduites d'un compteur : elles sont déclarées
-- nommément dans `room_openings` (une ligne = une salle + une plage). La
-- colonne `nb_salles` n'est plus lue ni écrite par l'application, et le
-- panneau « Logistique des créneaux » de /dashboard/planning (qui doublonnait
-- le champ « Nombre d'examinateurs par créneau » du formulaire d'épreuve) a
-- été supprimé.
--
-- OPTIONNEL : à n'exécuter qu'une fois le déploiement du code en place.
-- ALTER TABLE epreuves DROP COLUMN IF EXISTS nb_salles;


-- ============================================================
-- 2026-08-20 : mots de passe — lien de réinitialisation par email
--    (supabase-migration-password-reset.sql)
-- ============================================================
-- Nécessaire pour « Mot de passe oublié ? », l'envoi d'un lien de
-- définition de mot de passe par un admin, et l'obligation de changer de
-- mot de passe à la prochaine connexion.
--
-- `password_reset_token` stocke l'EMPREINTE SHA-256 du jeton, jamais le
-- jeton lui-même.

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS password_reset_token TEXT,
  ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_members_password_reset_token
  ON members (password_reset_token)
  WHERE password_reset_token IS NOT NULL;


-- ============================================================
-- 2026-08-21 : inscription candidate ATOMIQUE (anti-survente)
--    (supabase-migration-enroll-atomic.sql)
-- ============================================================
-- Trouvé en test de charge : sous forte contention, la vérification de
-- capacité + insertion en 2 temps côté JS laissait passer une survente
-- intermittente (jusqu'à 10 inscrits pour 8 places avec 200 candidats
-- simultanés). Cette fonction verrouille + compte + écrit en UNE seule
-- transaction Postgres. Tant qu'elle n'est pas appliquée, l'app retombe
-- sur l'ancien comportement (best-effort, fenêtre de course connue).

create or replace function enroll_candidate_atomic(
  p_slot_id uuid,
  p_candidate_id uuid,
  p_max_candidates integer
) returns jsonb
language plpgsql
as $$
declare
  v_existing_id uuid;
  v_existing_status text;
  v_active_count integer;
  v_row_id uuid;
begin
  perform 1 from evaluation_slots where id = p_slot_id for update;

  select id, status into v_existing_id, v_existing_status
    from slot_enrollments
    where slot_id = p_slot_id and candidate_id = p_candidate_id;

  if v_existing_id is not null
     and (v_existing_status is null or v_existing_status in ('active', 'enrolled')) then
    return jsonb_build_object('id', v_existing_id, 'status', 'already_enrolled');
  end if;

  select count(*) into v_active_count
    from slot_enrollments
    where slot_id = p_slot_id
      and (status is null or status in ('active', 'enrolled'));

  if v_active_count >= p_max_candidates then
    return jsonb_build_object('status', 'full');
  end if;

  if v_existing_id is not null then
    update slot_enrollments
      set status = 'active', enrolled_at = now()
      where id = v_existing_id;
    v_row_id := v_existing_id;
  else
    insert into slot_enrollments (slot_id, candidate_id, status, enrolled_at)
      values (p_slot_id, p_candidate_id, 'active', now())
      returning id into v_row_id;
  end if;

  if v_active_count + 1 >= p_max_candidates then
    update evaluation_slots set status = 'full' where id = p_slot_id;
  end if;

  return jsonb_build_object('id', v_row_id, 'status', 'created');
end;
$$;
