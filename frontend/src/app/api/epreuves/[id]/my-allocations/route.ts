import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized } from '@/lib/auth';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

// GET /api/epreuves/[id]/my-allocations
// Évaluateur connecté : ses inscriptions + son allocation personnelle
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();

  try {
    // Mes inscriptions (candidatures)
    const { data: myRequests } = await supabaseAdmin
      .from('slot_availability_requests')
      .select(`
        slot_id,
        slot:evaluation_slots(id, date, start_time, end_time, room, ordre)
      `)
      .eq('member_id', user.id)
      .filter('slot.epreuve_id', 'eq', params.id);

    // Mes allocations
    const { data: myAllocs } = await supabaseAdmin
      .from('evaluator_allocations')
      .select(`
        slot_id, rang_priorite, score_priorite, statut,
        slot:evaluation_slots(id, date, start_time, end_time, room)
      `)
      .eq('epreuve_id', params.id)
      .eq('member_id', user.id)
      .order('rang_priorite', { ascending: true });

    const allocBySlot: Record<string, any> = {};
    for (const a of myAllocs || []) {
      allocBySlot[a.slot_id] = a;
    }

    // Merge inscriptions + allocations
    const allocations = (myRequests || [])
      .filter((r: any) => r.slot) // slots qui appartiennent bien à cette épreuve
      .map((r: any) => {
        const alloc = allocBySlot[r.slot_id];
        return {
          slot_id: r.slot_id,
          date: r.slot?.date,
          heure_debut: r.slot?.start_time,
          heure_fin: r.slot?.end_time,
          salle: r.slot?.room,
          rang_dans_creneau: alloc?.rang_priorite ?? null,
          score: alloc?.score_priorite ?? null,
          statut: alloc?.statut ?? 'en_attente_allocation',
        };
      })
      .sort((a: any, b: any) => (a.date > b.date ? 1 : -1));

    const summary = {
      total_inscriptions: allocations.length,
      affectes:  allocations.filter((a: any) => a.statut === 'affecte').length,
      en_attente: allocations.filter((a: any) => a.statut === 'en_attente').length,
      en_attente_allocation: allocations.filter((a: any) => a.statut === 'en_attente_allocation').length,
    };

    return Response.json({ allocations, summary });
  } catch (e: any) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
