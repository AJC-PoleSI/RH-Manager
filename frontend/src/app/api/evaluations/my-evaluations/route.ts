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
      .eq('memberId', memberId);

    if (error) throw error;

    const parsed = (evaluations || []).map((e) => ({
      ...e,
      scores:
        typeof e.scores === 'string' ? JSON.parse(e.scores) : e.scores,
    }));

    return Response.json(parsed);
  } catch (error) {
    return Response.json({ error: 'Failed to fetch evaluations' }, { status: 500 });
  }
}
