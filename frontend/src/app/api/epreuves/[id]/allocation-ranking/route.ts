import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

// GET /api/epreuves/[id]/allocation-ranking
// Admin: ranking complet par créneau (polling-friendly)
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  try {
    const { data: epreuve } = await supabaseAdmin
      .from('epreuves').select('workflow_status, min_evaluators_per_salle').eq('id', params.id).single();

    const { data: slots } = await supabaseAdmin
      .from('evaluation_slots')
      .select(`
        id, date, start_time, end_time, room, status, ordre,
        requests:slot_availability_requests(
          member_id,
          member:members(id, email, first_name, last_name)
        )
      `)
      .eq('epreuve_id', params.id)
      .order('ordre', { ascending: true });

    const { data: allocations } = await supabaseAdmin
      .from('evaluator_allocations')
      .select('slot_id, member_id, rang_priorite, score_priorite, statut, modifie_par_admin')
      .eq('epreuve_id', params.id);

    const allocBySlot: Record<string, any[]> = {};
    for (const a of allocations || []) {
      if (!allocBySlot[a.slot_id]) allocBySlot[a.slot_id] = [];
      allocBySlot[a.slot_id].push(a);
    }

    const quotaZ = epreuve?.min_evaluators_per_salle || 2;

    const creneaux = (slots || []).map((slot: any) => {
      const allocs = (allocBySlot[slot.id] || []).sort((a: any, b: any) => a.rang_priorite - b.rang_priorite);
      const affectes  = allocs.filter((a: any) => a.statut === 'affecte');
      const enAttente = allocs.filter((a: any) => a.statut === 'en_attente');

      // Enrichir avec les infos member depuis les requests
      const memberMap: Record<string, any> = {};
      for (const r of slot.requests || []) {
        memberMap[r.member_id] = r.member;
      }

      const enrich = (a: any) => ({
        ...a,
        member: memberMap[a.member_id] || { id: a.member_id, email: a.member_id },
      });

      return {
        id: slot.id,
        date: slot.date,
        heure_debut: slot.start_time,
        heure_fin: slot.end_time,
        salle: slot.room,
        quota: quotaZ,
        total_inscrits: slot.requests?.length || 0,
        affectes: affectes.map(enrich),
        en_attente: enAttente.map(enrich),
        statut: affectes.length >= quotaZ ? 'OK' : 'NON_REMPLI',
      };
    });

    const total = creneaux.length;
    const complets = creneaux.filter(c => c.statut === 'OK').length;

    return Response.json({
      workflow_status: epreuve?.workflow_status,
      creneaux,
      summary: {
        total_creneaux: total,
        creneaux_complets: complets,
        creneaux_non_remplis: total - complets,
        quota_z: quotaZ,
      },
    });
  } catch (e: any) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
