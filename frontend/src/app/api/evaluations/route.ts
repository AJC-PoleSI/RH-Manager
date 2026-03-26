import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized } from '@/lib/auth';
import { NextRequest } from 'next/server';

// GET /api/evaluations - Fetch all evaluations
export async function GET() {
  try {
    const { data: evaluations, error } = await supabaseAdmin
      .from('candidate_evaluations')
      .select('*, epreuves(*), candidates(*), members(id, email, first_name, last_name)');

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
      member: e.members ? {
        id: e.members.id,
        firstName: e.members.first_name || '',
        lastName: e.members.last_name || '',
        email: e.members.email,
      } : null,
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
        candidate_id: candidateId,
        epreuve_id: epreuveId,
        member_id: memberId,
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
        member_id: memberId,
        candidate_id: candidateId,
        evaluation_id: evaluation.id,
      });

    if (trackError) {
      console.error('Failed to create evaluator tracking:', trackError);
    }

    return Response.json(evaluation, { status: 201 });
  } catch (error) {
    return Response.json({ error: 'Failed to submit evaluation' }, { status: 400 });
  }
}
