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


-- ------------------------------------------------------------
-- 5) Colonnes utilisées par le code mais absentes des migrations
--    (supabase-migration-colonnes-manquantes.sql)
-- ------------------------------------------------------------
-- Audit du 25 août 2026. `epreuves.color` et `epreuves.description` existent
-- en production (ajoutées à la main) mais dans aucun fichier du dépôt :
-- reconstruire la base depuis le repo donne une app cassée dès la création
-- d'épreuve. `deliberations.assigned_pole` est absente PARTOUT, y compris en
-- production, et faisait échouer GET /api/kpis/poles en 500 (code 42703).
--
-- La route tolère désormais son absence, mais la colonne reste nécessaire au
-- décompte des places acceptées par pôle.

ALTER TABLE epreuves ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#3B82F6';
ALTER TABLE epreuves ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE deliberations ADD COLUMN IF NOT EXISTS assigned_pole TEXT;


-- ------------------------------------------------------------
-- 6) Organigramme des candidats : photos + coups de cœur
--    (supabase-migration-photos-coups-de-coeur.sql)
-- ------------------------------------------------------------
-- Trombinoscope du jury (photo + nom/prénom), photo reprise en délibération,
-- et 5 coups de cœur par membre pour tout le recrutement (un cœur par
-- candidat ; un cœur posé sur un candidat éliminé est réutilisable).
--
-- Photos dans une table à part : les routes existantes font `select("*")`
-- sur `candidates`, une colonne image y ferait transiter des mégaoctets à
-- chaque appel.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS candidate_photos (
  candidate_id UUID PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  mime_type    TEXT        NOT NULL,
  data         TEXT        NOT NULL,          -- image base64 (sans préfixe data:)
  byte_size    INTEGER     NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   TEXT
);

ALTER TABLE candidate_photos ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS candidate_favorites (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id    UUID NOT NULL REFERENCES members(id)    ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_favorites_member_candidate
  ON candidate_favorites (member_id, candidate_id);

CREATE INDEX IF NOT EXISTS idx_candidate_favorites_candidate
  ON candidate_favorites (candidate_id);

ALTER TABLE candidate_favorites ENABLE ROW LEVEL SECURITY;


-- ------------------------------------------------------------
-- 7) Dispatch : affectations manuelles protégées du rebrassage
--    (audit fonctionnel du 07/09/2026)
-- ------------------------------------------------------------
-- Sans cette colonne, toute sauvegarde de disponibilité par n'importe quel
-- membre relance un dispatch global qui peut défaire, sans prévenir l'admin,
-- un jury qu'il a composé à la main (bouton "ajouter/retirer" du planning).
-- `is_manual=true` épingle le créneau : le dispatch le traite comme clôturé
-- (jury conservé, seulement complété si sous-effectif).

ALTER TABLE slot_member_assignments
  ADD COLUMN IF NOT EXISTS is_manual boolean NOT NULL DEFAULT false;


-- ------------------------------------------------------------
-- 8) Intégration Befast ↔ RH Manager
--    (supabase-migration-befast-integration.sql — absente de ce fichier
--    jusqu'ici, donc la plus exposée à l'oubli lors d'un prochain passage
--    en SQL Editor ; audit du 07/09/2026)
-- ------------------------------------------------------------
-- Colonnes de liaison + miroir des documents poussés par Befast. Tant
-- qu'elles manquent, POST /api/internal/provision et /api/internal/documents
-- répondent désormais 503 explicite (au lieu d'un échec silencieux ou d'une
-- 500 Postgres brute — voir ces deux routes).

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS befast_person_id uuid,
  -- provenance : 'onboarding' (hub), 'rh_direct', 'befast_direct', 'backfill'
  ADD COLUMN IF NOT EXISTS onboarding_source text,
  -- payload curé des documents poussés par Befast (références, pas les fichiers)
  ADD COLUMN IF NOT EXISTS befast_documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS befast_documents_complete boolean NOT NULL DEFAULT false;

-- Un candidat RH est lié à au plus une personne Befast.
CREATE UNIQUE INDEX IF NOT EXISTS candidates_befast_person_id_key
  ON public.candidates (befast_person_id)
  WHERE befast_person_id IS NOT NULL;


-- ------------------------------------------------------------
-- 9) Minimum de candidats pour les épreuves de groupe (business game)
--    (supabase-migration-min-candidates.sql)
-- ------------------------------------------------------------
-- Pour une épreuve de groupe, l'admin peut fixer un minimum de candidats par
-- créneau (en plus du maximum déjà existant via group_size). La règle
-- métier associée (min_evaluators_per_salle = min_candidates) est gérée par
-- l'application, pas par une contrainte SQL.

ALTER TABLE epreuves
  ADD COLUMN IF NOT EXISTS min_candidates INTEGER;

ALTER TABLE evaluation_slots
  ADD COLUMN IF NOT EXISTS min_candidates INTEGER;


-- ------------------------------------------------------------
-- 10) Dispos simultanées : l'examinateur coche, l'algorithme tranche
--     (supabase-migration-dispos-simultanees.sql)
-- ------------------------------------------------------------
-- Un examinateur peut se déclarer disponible sur deux épreuves qui tombent au
-- même moment ; le dispatch en choisit une (celle qui risque le plus de ne pas
-- faire passer tous ses candidats) et le laisse remplaçant sur l'autre.
--
-- Tant que ces deux colonnes manquent, l'application fonctionne mais dégradée :
--   • sans `availabilities.epreuve_id` : cocher une épreuve rend disponible
--     pour toute épreuve au même moment (l'ancien comportement) ;
--   • sans `slot_availability_requests.source` : le « perdant » de l'arbitrage
--     n'est pas mis en liste d'attente sur le créneau non retenu.
-- Les deux cas sont signalés par un console.warn au dispatch.

ALTER TABLE public.availabilities
  ADD COLUMN IF NOT EXISTS epreuve_id UUID REFERENCES public.epreuves(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_availability_epreuve
  ON public.availabilities (epreuve_id);

ALTER TABLE public.slot_availability_requests
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'member';

CREATE INDEX IF NOT EXISTS idx_slot_requests_source
  ON public.slot_availability_requests (source);


-- ------------------------------------------------------------
-- 11) Vérification d'email candidat — colonnes manquantes des migrations
--     (audit du 09/09/2026)
-- ------------------------------------------------------------
-- `email_verified`, `verification_token` et `verification_token_expires_at`
-- sont utilisées par POST /api/auth/register-candidate, verify-email,
-- candidate-login et resend-verification, mais n'existent dans aucun fichier
-- de migration du dépôt (probablement ajoutées à la main en prod). Sans
-- elles, l'inscription candidate échoue immédiatement (Postgres 42703) sur
-- toute base reconstruite depuis le repo.

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_token TEXT,
  ADD COLUMN IF NOT EXISTS verification_token_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_candidates_verification_token
  ON candidates (verification_token)
  WHERE verification_token IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- REFONTE CRÉNEAUX : estimation du nombre de créneaux nécessaires
-- (septembre 2026 — voir supabase-migration-estimation-creneaux.sql)
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE public.epreuves
  ADD COLUMN IF NOT EXISTS candidats_attendus INTEGER,
  ADD COLUMN IF NOT EXISTS marge_pct INTEGER NOT NULL DEFAULT 25;

-- ═══════════════════════════════════════════════════════════════
-- REFONTE CRÉNEAUX : candidats attendus au niveau du TOUR
-- (septembre 2026 — voir supabase-migration-tour-settings.sql)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.tour_settings (
  tour INTEGER PRIMARY KEY,
  candidats_attendus INTEGER,
  marge_pct INTEGER NOT NULL DEFAULT 25
);

-- ═══════════════════════════════════════════════════════════════
-- URGENT — table evaluator_allocations absente de la prod
-- (trouvé le 09/09/2026 : cause directe des timeouts de 300s sur
-- PUT /api/availability constatés en prod depuis le 08/09 — voir
-- supabase-migration-allocation.sql. dispatchService.ts a été corrigé
-- pour ne plus marteler cette table quand elle manque, mais tant que
-- cette migration n'est pas posée, les remplaçants/liste d'attente ne
-- sont jamais enregistrés.)
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE epreuves
  ADD COLUMN IF NOT EXISTS workflow_status TEXT DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS heure_debut_journee TEXT DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS heure_fin_journee TEXT DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS salles_names JSONB DEFAULT '[]';

ALTER TABLE evaluation_slots
  ADD COLUMN IF NOT EXISTS ordre INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS evaluator_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  epreuve_id UUID NOT NULL REFERENCES epreuves(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES evaluation_slots(id) ON DELETE CASCADE,
  rang_priorite INTEGER NOT NULL,
  score_priorite FLOAT DEFAULT 0,
  statut TEXT NOT NULL DEFAULT 'affecte',
  modifie_par_admin BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(slot_id, member_id)
);

CREATE TABLE IF NOT EXISTS allocation_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  epreuve_id UUID NOT NULL REFERENCES epreuves(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  allocations JSONB,
  statistiques JSONB,
  triggered_by TEXT DEFAULT 'allocation_initiale',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- URGENT — garde-fou anti double-booking examinateur (10/09/2026)
-- Constat en prod : des examinateurs inscrits sur DEUX créneaux qui se
-- chevauchent, MÊME ÉPREUVE (ex. salles 205 et 217 le lundi 14/09 à la même
-- heure). Cause probable : race condition check-then-insert entre deux
-- requêtes concurrentes (double-clic, deux dispatch en parallèle...) — voir
-- supabase-migration-examiner-overlap-guard.sql pour le détail. Ce trigger
-- ferme la fenêtre de race au niveau base et rejette tout INSERT qui
-- créerait un chevauchement, quel que soit le code appelant.
-- ═══════════════════════════════════════════════════════════════
create or replace function check_member_slot_overlap()
returns trigger
language plpgsql
as $$
declare
  v_date date;
  -- TEXT "HH:MM" (pas `time`), comme evaluation_slots.start_time/end_time —
  -- testé en local, la version `time` casse tout insert (text < time
  -- without time zone n'existe pas).
  v_start text;
  v_end text;
  v_conflict_count int;
begin
  perform pg_advisory_xact_lock(hashtext(new.member_id::text));

  select date::date, start_time, end_time
    into v_date, v_start, v_end
    from evaluation_slots
    where id = new.slot_id;

  if v_date is null then
    return new;
  end if;

  select count(*)
    into v_conflict_count
    from slot_member_assignments sma
    join evaluation_slots es on es.id = sma.slot_id
    where sma.member_id = new.member_id
      and sma.slot_id <> new.slot_id
      and es.date::date = v_date
      and es.start_time < v_end
      and v_start < es.end_time;

  if v_conflict_count > 0 then
    raise exception
      'Conflit horaire : ce membre a déjà un créneau qui chevauche % %-%',
      v_date, v_start, v_end
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_check_member_slot_overlap on slot_member_assignments;

create trigger trg_check_member_slot_overlap
  before insert on slot_member_assignments
  for each row
  execute function check_member_slot_overlap();


-- ------------------------------------------------------------
-- N) Verrouillage des évaluations + attribution binôme
--    (supabase-migration-evaluation-lock.sql)
-- ------------------------------------------------------------
-- Une évaluation à auteur unique (is_group=false) se clôture automatiquement
-- dès sa soumission ; seul un admin peut la rouvrir (POST .../reopen). Sur
-- une épreuve individuelle dont le créneau du candidat a 2 examinateurs
-- assignés ou plus, une seule note partagée est créée (is_group=true), un
-- seul examinateur la saisit, elle reste ouverte jusqu'à validation
-- explicite (POST .../close), et elle est attribuée à CHAQUE examinateur du
-- créneau (evaluator_tracking multi-lignes par évaluation).

ALTER TABLE candidate_evaluations
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reopened_by UUID REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE evaluator_tracking
  DROP CONSTRAINT IF EXISTS evaluator_tracking_evaluation_id_key;

ALTER TABLE evaluator_tracking
  DROP CONSTRAINT IF EXISTS uniq_evaluator_tracking_member_evaluation;

ALTER TABLE evaluator_tracking
  ADD CONSTRAINT uniq_evaluator_tracking_member_evaluation
  UNIQUE (member_id, evaluation_id);
