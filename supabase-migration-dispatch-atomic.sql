-- ============================================================
-- Écriture ATOMIQUE des affectations examinateurs (dispatch)
-- ============================================================
-- Le dispatch remplace les affectations d'un lot de créneaux : il SUPPRIME
-- puis RÉINSÈRE. Sans transaction, un échec d'insert laissait des créneaux
-- SANS jury (delete déjà appliqué). Cette fonction fait delete + insert dans
-- UNE seule transaction : si l'insert échoue, le delete est annulé (rollback).
--
-- Le code applicatif (dispatch-io.ts) l'appelle via
--   supabaseAdmin.rpc('replace_slot_assignments', { p_slot_ids, p_assignments })
-- et retombe sur l'ancien delete+insert tant que cette fonction n'existe pas,
-- donc l'ordre déploiement code / migration est indifférent.
--
-- Idempotent : CREATE OR REPLACE. Ré-exécuter est sans effet de bord.

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
