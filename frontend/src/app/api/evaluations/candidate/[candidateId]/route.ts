import { supabaseAdmin } from '@/lib/supabase';
import { NextRequest } from 'next/server';

// GET /api/evaluations/candidate/[candidateId] - Fetch evaluations for a candidate
export async function GET(
  req: NextRequest,
  { params }: { params: { candidateId: string } }
) {
  const { candidateId } = params;

  try {
    const { data: evaluations, error } = await supabaseAdmin
      .from('candidate_evaluations')
      .select('*, epreuves(*), members(email)')
      .eq('candidate_id', candidateId);

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
