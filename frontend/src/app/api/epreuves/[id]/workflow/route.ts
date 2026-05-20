import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft:                  ['creneaux_finalises'],
  creneaux_finalises:     ['draft', 'published_evaluators'],
  published_evaluators:   ['creneaux_finalises', 'allocating'],
  allocating:             ['published_evaluators', 'allocated'],
  allocated:              ['allocating', 'published_candidates'],
  published_candidates:   ['allocated'],
};

// PATCH /api/epreuves/[id]/workflow  { status: newStatus }
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  try {
    const { status: newStatus } = await req.json();

    const { data: epreuve } = await supabaseAdmin
      .from('epreuves').select('workflow_status').eq('id', params.id).single();

    const current = epreuve?.workflow_status || 'draft';
    const allowed = VALID_TRANSITIONS[current] || [];

    if (!allowed.includes(newStatus)) {
      return Response.json(
        { error: `Transition invalide: ${current} → ${newStatus}` },
        { status: 400 }
      );
    }

    // When publishing to evaluators: switch draft slots to 'open' so members can subscribe
    if (newStatus === 'published_evaluators') {
      await supabaseAdmin.from('evaluation_slots')
        .update({ status: 'open' })
        .eq('epreuve_id', params.id).eq('status', 'draft');
    }

    // When publishing to candidates: switch allocated slots to 'published'
    if (newStatus === 'published_candidates') {
      await supabaseAdmin.from('evaluation_slots')
        .update({ status: 'published' })
        .eq('epreuve_id', params.id).in('status', ['open', 'ready']);
    }

    const { error } = await supabaseAdmin.from('epreuves')
      .update({ workflow_status: newStatus }).eq('id', params.id);
    if (error) throw error;

    return Response.json({ success: true, workflow_status: newStatus });
  } catch (e: any) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

// GET /api/epreuves/[id]/workflow — current status + slot counts
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();

  try {
    const { data: epreuve } = await supabaseAdmin
      .from('epreuves')
      .select('id, name, workflow_status, min_evaluators_per_salle, heure_debut_journee, heure_fin_journee, salles_names')
      .eq('id', params.id).single();

    const { data: slots } = await supabaseAdmin
      .from('evaluation_slots').select('id, status')
      .eq('epreuve_id', params.id);

    const { data: subs } = await supabaseAdmin
      .from('slot_availability_requests').select('id, slot_id')
      .in('slot_id', (slots || []).map((s: any) => s.id));

    const { data: allocs } = await supabaseAdmin
      .from('evaluator_allocations').select('id, statut')
      .eq('epreuve_id', params.id);

    return Response.json({
      epreuve,
      counts: {
        total_slots: slots?.length || 0,
        subscriptions: subs?.length || 0,
        affectes: allocs?.filter((a: any) => a.statut === 'affecte').length || 0,
        en_attente: allocs?.filter((a: any) => a.statut === 'en_attente').length || 0,
      },
    });
  } catch (e: any) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
