import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

// PUT /api/epreuves/[id] - Update an epreuve (admin only)
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  const { id } = params;

  try {
    const { name, tour, type, durationMinutes, evaluationQuestions, isPoleTest, pole } =
      await req.json();

    // Build update object with only provided fields (snake_case for Supabase)
    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (tour !== undefined) updateData.tour = tour;
    if (type !== undefined) updateData.type = type;
    if (durationMinutes !== undefined) updateData.duration_minutes = durationMinutes;
    if (isPoleTest !== undefined) updateData.is_pole_test = isPoleTest;
    if (pole !== undefined) updateData.pole = pole;
    if (evaluationQuestions !== undefined) {
      updateData.evaluation_questions =
        typeof evaluationQuestions === 'string'
          ? evaluationQuestions
          : JSON.stringify(evaluationQuestions);
    }

    const { data: epreuve, error } = await supabaseAdmin
      .from('epreuves')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return Response.json(epreuve);
  } catch (error) {
    return Response.json({ error: 'Failed to update epreuve' }, { status: 400 });
  }
}

// DELETE /api/epreuves/[id] - Delete an epreuve (admin only)
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  const { id } = params;

  try {
    const { error } = await supabaseAdmin
      .from('epreuves')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json({ error: 'Failed to delete epreuve' }, { status: 400 });
  }
}
