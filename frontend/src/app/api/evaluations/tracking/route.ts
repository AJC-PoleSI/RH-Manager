import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

// GET /api/evaluations/tracking - Fetch all evaluator tracking data (admin only)
export async function GET(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  try {
    const { data: tracking, error } = await supabaseAdmin
      .from('evaluator_tracking')
      .select(`
        *,
        members(id, email),
        candidates(id, first_name, last_name),
        candidate_evaluations(scores, comment, epreuves(name))
      `);

    if (error) throw error;

    return Response.json(tracking || []);
  } catch (error) {
    return Response.json({ error: 'Failed to fetch tracking data' }, { status: 500 });
  }
}
