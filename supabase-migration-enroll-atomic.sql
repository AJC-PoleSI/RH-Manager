-- ============================================================
-- Inscription candidate ATOMIQUE (créneaux) — anti-survente
-- ============================================================
-- L'inscription (POST /api/slots/enroll) vérifiait la capacité puis
-- insérait en JS, en 2 requêtes séparées : sous forte contention (ex.
-- ouverture des inscriptions, beaucoup de candidats cliquent en même
-- temps), deux requêtes peuvent chacune se croire "dans les clous" au
-- moment de leur vérification, avant de voir l'insertion de l'autre —
-- le créneau se retrouve avec plus d'inscrits que sa capacité.
--
-- Mesuré en test de charge (200 inscriptions simultanées sur un créneau
-- à 8 places) : survente reproduite 2 fois sur 5 (jusqu'à 10 inscrits
-- pour 8 places). Cette fonction ferme la fenêtre de course en faisant
-- verrou + comptage + écriture dans UNE seule transaction Postgres :
-- toute transaction concurrente sur le MÊME créneau attend le commit de
-- celle-ci avant de pouvoir lire/écrire à son tour.
--
-- Le code applicatif (src/app/api/slots/enroll/route.ts) l'appelle via
--   supabaseAdmin.rpc('enroll_candidate_atomic', { p_slot_id, p_candidate_id, p_max_candidates })
-- et retombe sur l'ancien comportement (best-effort, non atomique) tant
-- que cette fonction n'existe pas — l'ordre déploiement code / migration
-- est donc indifférent, comme pour replace_slot_assignments (dispatch).
--
-- Idempotent : CREATE OR REPLACE. Ré-exécuter est sans effet de bord.

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
  -- Verrou pessimiste sur la ligne du créneau : toute transaction
  -- concurrente ciblant ce même slot_id attend ici jusqu'au COMMIT de
  -- celle-ci — c'est ce qui élimine la fenêtre "compter puis insérer".
  perform 1 from evaluation_slots where id = p_slot_id for update;

  select id, status into v_existing_id, v_existing_status
    from slot_enrollments
    where slot_id = p_slot_id and candidate_id = p_candidate_id;

  -- Idempotence : une inscription déjà active est renvoyée telle quelle
  -- (sûr à rejouer), sans repasser par la vérification de capacité.
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
    -- Ligne CANCELLED existante → réactivation (la contrainte unique
    -- (slot_id, candidate_id) interdit d'en insérer une seconde).
    update slot_enrollments
      set status = 'active', enrolled_at = now()
      where id = v_existing_id;
    v_row_id := v_existing_id;
  else
    insert into slot_enrollments (slot_id, candidate_id, status, enrolled_at)
      values (p_slot_id, p_candidate_id, 'active', now())
      returning id into v_row_id;
  end if;

  -- Le créneau vient peut-être d'atteindre sa capacité : on le marque
  -- "full" dans la MÊME transaction (toujours sous le verrou), pour que
  -- les prochains arrivants voient l'état à jour immédiatement.
  if v_active_count + 1 >= p_max_candidates then
    update evaluation_slots set status = 'full' where id = p_slot_id;
  end if;

  return jsonb_build_object('id', v_row_id, 'status', 'created');
end;
$$;
