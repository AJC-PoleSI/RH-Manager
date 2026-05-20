import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

// PATCH /api/epreuves/[id]/allocation-manual
// Admin ajoute ou retire manuellement un évaluateur d'un créneau
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  try {
    const { action, slot_id, member_id } = await req.json();
    if (!action || !slot_id || !member_id) {
      return Response.json({ error: 'action, slot_id, member_id requis' }, { status: 400 });
    }

    const { data: epreuve } = await supabaseAdmin
      .from('epreuves').select('min_evaluators_per_salle, workflow_status').eq('id', params.id).single();

    const quotaZ = epreuve?.min_evaluators_per_salle || 2;

    if (action === 'remove') {
      // Supprimer l'allocation
      await supabaseAdmin.from('evaluator_allocations')
        .delete().eq('slot_id', slot_id).eq('member_id', member_id);

      // Retirer aussi du slot_member_assignments
      await supabaseAdmin.from('slot_member_assignments')
        .delete().eq('slot_id', slot_id).eq('member_id', member_id);

      // Promouvoir le premier en_attente → affecte
      const { data: waitingList } = await supabaseAdmin
        .from('evaluator_allocations')
        .select('id, member_id, rang_priorite')
        .eq('slot_id', slot_id).eq('statut', 'en_attente')
        .order('rang_priorite', { ascending: true }).limit(1);

      if (waitingList && waitingList.length > 0) {
        const promoted = waitingList[0];
        await supabaseAdmin.from('evaluator_allocations')
          .update({ statut: 'affecte', modifie_par_admin: true }).eq('id', promoted.id);
        await supabaseAdmin.from('slot_member_assignments')
          .insert({ slot_id, member_id: promoted.member_id });
      }
    } else if (action === 'add') {
      // Vérifier que le membre n'est pas déjà affecté
      const { data: existing } = await supabaseAdmin
        .from('evaluator_allocations')
        .select('id').eq('slot_id', slot_id).eq('member_id', member_id).limit(1);
      if (existing && existing.length > 0) {
        return Response.json({ error: 'Déjà affecté à ce créneau' }, { status: 400 });
      }

      // Récupérer le rang max actuel
      const { data: current } = await supabaseAdmin
        .from('evaluator_allocations').select('rang_priorite')
        .eq('slot_id', slot_id).order('rang_priorite', { ascending: false }).limit(1);

      const nextRang = ((current?.[0]?.rang_priorite) || 0) + 1;
      const statut = nextRang <= quotaZ ? 'affecte' : 'en_attente';

      await supabaseAdmin.from('evaluator_allocations').insert({
        epreuve_id: params.id,
        member_id,
        slot_id,
        rang_priorite: nextRang,
        score_priorite: 0,
        statut,
        modifie_par_admin: true,
      });

      if (statut === 'affecte') {
        await supabaseAdmin.from('slot_member_assignments')
          .upsert({ slot_id, member_id }, { onConflict: 'slot_id,member_id' });
      }
    }

    // Retourner l'état mis à jour du créneau
    const { data: updated } = await supabaseAdmin
      .from('evaluator_allocations')
      .select('member_id, rang_priorite, score_priorite, statut')
      .eq('slot_id', slot_id)
      .order('rang_priorite', { ascending: true });

    return Response.json({ success: true, slot_id, allocations: updated });
  } catch (e: any) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
