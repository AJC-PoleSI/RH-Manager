import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized } from '@/lib/auth';
import { NextRequest } from 'next/server';

// PUT /api/evaluations/[id] - Update an evaluation
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();

  const { id } = params;

  try {
    const { scores, comment } = await req.json();

    const updateData: Record<string, unknown> = {};
    if (scores !== undefined) {
      updateData.scores = typeof scores === 'string' ? scores : JSON.stringify(scores);
    }
    if (comment !== undefined) updateData.comment = comment;

    const { data, error } = await supabaseAdmin
      .from('candidate_evaluations')
      .update(updateData)
      .eq('id', id)
      .select('*, epreuves(*), members(email)')
      .single();

    if (error) throw error;

    return Response.json({
      ...data,
      scores: typeof data.scores === 'string' ? JSON.parse(data.scores) : data.scores,
    });
  } catch (error) {
    console.error('Evaluation PUT error:', error);
    return Response.json({ error: 'Failed to update evaluation' }, { status: 400 });
  }
}

// DELETE /api/evaluations/[id] - Delete an evaluation
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();

  const { id } = params;

  try {
    // Delete tracking record first
    await supabaseAdmin
      .from('evaluator_tracking')
      .delete()
      .eq('evaluation_id', id);

    const { error } = await supabaseAdmin
      .from('candidate_evaluations')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Evaluation DELETE error:', error);
    return Response.json({ error: 'Failed to delete evaluation' }, { status: 400 });
  }
}
