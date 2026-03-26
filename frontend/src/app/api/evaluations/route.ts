import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized } from '@/lib/auth';
import { NextRequest } from 'next/server';

// GET /api/evaluations - Fetch all evaluations
export async function GET() {
  try {
    const { data: evaluations, error } = await supabaseAdmin
      .from('candidate_evaluations')
      .select('*, epreuves(*), candidates(*), members(email)');

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

// POST /api/evaluations - Submit an evaluation
export async function POST(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();

  const memberId = user.id;

  try {
    const { candidateId, epreuveId, scores, comment } = await req.json();

    // Create the evaluation
    const { data: evaluation, error: evalError } = await supabaseAdmin
      .from('candidate_evaluations')
      .insert({
        candidateId,
        epreuveId,
        memberId,
        scores: typeof scores === 'string' ? scores : JSON.stringify(scores),
        comment,
      })
      .select()
      .single();

    if (evalError) throw evalError;

    // Create evaluator tracking record
    const { error: trackError } = await supabaseAdmin
      .from('evaluator_tracking')
      .insert({
        memberId,
        candidateId,
        evaluationId: evaluation.id,
      });

    if (trackError) {
      console.error('Failed to create evaluator tracking:', trackError);
    }

    return Response.json(evaluation, { status: 201 });
  } catch (error) {
    return Response.json({ error: 'Failed to submit evaluation' }, { status: 400 });
  }
}
