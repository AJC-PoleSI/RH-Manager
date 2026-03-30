import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized } from '@/lib/auth';
import { NextRequest } from 'next/server';

// GET /api/evaluations/my-evaluations - Fetch current member's evaluations
export async function GET(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();

  const memberId = user.id;

  try {
    const { data: evaluations, error } = await supabaseAdmin
      .from('candidate_evaluations')
      .select('*, candidates(*), epreuves(*)')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const parsed = (evaluations || []).map((e: any) => ({
      id: e.id,
      scores: typeof e.scores === 'string' ? JSON.parse(e.scores) : e.scores,
      comment: e.comment,
      createdAt: e.created_at,
      candidate: e.candidates ? {
        id: e.candidates.id,
        firstName: e.candidates.first_name,
        lastName: e.candidates.last_name,
      } : { id: '', firstName: '', lastName: '' },
      epreuve: e.epreuves ? {
        name: e.epreuves.name,
        tour: e.epreuves.tour,
        type: e.epreuves.type,
      } : { name: '', tour: 0, type: '' },
    }));

    return Response.json(parsed);
  } catch (error) {
    return Response.json({ error: 'Failed to fetch evaluations' }, { status: 500 });
  }
}
