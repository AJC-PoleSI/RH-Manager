-- ============================================================
-- GARDE-FOU BASE DE DONNÉES : un examinateur ne peut pas être
-- affecté à deux créneaux qui se chevauchent dans le temps
-- ============================================================
-- Constat (Felix, 10/09/2026) : plusieurs examinateurs inscrits sur DEUX
-- créneaux de la MÊME épreuve, au MÊME horaire, le lundi 14/09/2026 (ex.
-- Félix Pitz sur les salles 205 ET 217 à 10h00-10h25 ; Mylène Andela Ebela
-- sur 205 ET 217 à 8h30-8h55). Toutes les lignes en cause sont
-- `is_manual = false` et le créneau n'était pas verrouillé : ça n'est ni le
-- dispatch (qui exclut ces doublons à l'intérieur d'un même run, cf.
-- dispatch-core.ts::scoreMember / dispatchService.ts::wouldConflict) ni un
-- placement admin délibéré.
--
-- Cause la plus probable : une RACE CONDITION check-then-insert. Le code
-- applicatif (toggle-member, dispatch) fait TOUJOURS "vérifier qu'il n'y a
-- pas de conflit" PUIS "insérer" en deux allers-retours Supabase séparés
-- (pas une transaction). Si deux requêtes concurrentes pour le même membre
-- s'exécutent en même temps (double-clic, deux onglets, deux dispatch
-- lancés en parallèle...), les DEUX lisent "pas de conflit" avant que l'une
-- des deux n'ait committé son insert, et les deux affectations qui se
-- chevauchent sont acceptées. Aucune vérification applicative ne peut fermer
-- cette fenêtre de façon fiable : il faut un verrou côté base.
--
-- Ce trigger BEFORE INSERT :
--   1. Prend un verrou advisory PAR MEMBRE (pg_advisory_xact_lock) : toute
--      transaction concurrente qui insère pour le MÊME membre est mise en
--      attente jusqu'au commit/rollback de la première. Ça ferme la fenêtre
--      de race ci-dessus.
--   2. Vérifie ensuite qu'aucune autre affectation de ce membre, sur une
--      AUTRE ligne, ne chevauche l'horaire du créneau visé.
--   3. Rejette l'insert (exception) si conflit — quel que soit le code
--      appelant (dispatch, toggle-member, /slots/publish, /slots/generate,
--      futur code non encore écrit).
--
-- Idempotent : CREATE OR REPLACE + DROP TRIGGER IF EXISTS. Ré-exécuter est
-- sans effet de bord.
-- ============================================================

create or replace function check_member_slot_overlap()
returns trigger
language plpgsql
as $$
declare
  v_date date;
  v_start time;
  v_end time;
  v_conflict_count int;
begin
  -- Ferme la fenêtre de race : toute autre transaction qui insère pour ce
  -- même membre attend ici jusqu'à notre commit/rollback.
  perform pg_advisory_xact_lock(hashtext(new.member_id::text));

  select date, start_time, end_time
    into v_date, v_start, v_end
    from evaluation_slots
    where id = new.slot_id;

  -- Créneau introuvable (ne devrait pas arriver, FK oblige) : rien à
  -- vérifier, on laisse la FK faire son travail.
  if v_date is null then
    return new;
  end if;

  select count(*)
    into v_conflict_count
    from slot_member_assignments sma
    join evaluation_slots es on es.id = sma.slot_id
    where sma.member_id = new.member_id
      and sma.slot_id <> new.slot_id
      and es.date = v_date
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
