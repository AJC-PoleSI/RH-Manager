import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized } from '@/lib/auth';
import { NextRequest } from 'next/server';

// POST /api/epreuves/[id]/slot-subscribe  { slot_id }
// Évaluateur s'inscrit à un créneau (phase published_evaluators)
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();

  try {
    const { slot_id } = await req.json();
    if (!slot_id) return Response.json({ error: 'slot_id requis' }, { status: 400 });

    // Vérifier que l'épreuve est bien en phase published_evaluators
    const { data: epreuve } = await supabaseAdmin
      .from('epreuves').select('workflow_status').eq('id', params.id).single();
    if (!['published_evaluators', 'allocating'].includes(epreuve?.workflow_status)) {
      return Response.json({ error: 'Les inscriptions évaluateurs ne sont pas ouvertes' }, { status: 403 });
    }

    const { error } = await supabaseAdmin
      .from('slot_availability_requests')
      .insert({ slot_id, member_id: user.id });

    if (error) {
      if (error.code === '23505') return Response.json({ error: 'Déjà inscrit' }, { status: 400 });
      throw error;
    }

    return Response.json({ success: true });
  } catch (e: any) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

// DELETE /api/epreuves/[id]/slot-subscribe  { slot_id }
// Évaluateur se désinscrit d'un créneau
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();

  try {
    const { slot_id } = await req.json();
    if (!slot_id) return Response.json({ error: 'slot_id requis' }, { status: 400 });

    const { data: epreuve } = await supabaseAdmin
      .from('epreuves').select('workflow_status').eq('id', params.id).single();

    // Après allocation validée, désinscription impossible
    if (epreuve?.workflow_status === 'published_candidates') {
      return Response.json({ error: 'Désinscription impossible après publication candidats' }, { status: 403 });
    }

    await supabaseAdmin.from('slot_availability_requests')
      .delete().eq('slot_id', slot_id).eq('member_id', user.id);

    return Response.json({ success: true });
  } catch (e: any) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
