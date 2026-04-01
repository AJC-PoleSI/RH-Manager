import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

// PUT /api/epreuves/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  const { id } = params;

  try {
    const body = await req.json();
    console.log('[PUT /api/epreuves/:id] Request body:', JSON.stringify(body));
    const updateData: any = {};

    if (body.name !== undefined) updateData.name = body.name;
    if (body.tour !== undefined) updateData.tour = body.tour;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.durationMinutes !== undefined) updateData.duration_minutes = body.durationMinutes;
    if (body.roulementMinutes !== undefined) updateData.roulement_minutes = body.roulementMinutes;
    if (body.nbSalles !== undefined) updateData.nb_salles = body.nbSalles;
    if (body.minEvaluatorsPerSalle !== undefined) updateData.min_evaluators_per_salle = body.minEvaluatorsPerSalle;
    if (body.dateDebut !== undefined) updateData.date_debut = body.dateDebut;
    if (body.dateFin !== undefined) updateData.date_fin = body.dateFin;
    if (body.isPoleTest !== undefined) updateData.is_pole_test = body.isPoleTest;
    if (body.pole !== undefined) updateData.pole = body.pole;
    if (body.description !== undefined) updateData.description = body.description;
    // if (body.isVisible !== undefined) updateData.is_visible = body.isVisible; // TODO: add to Supabase schema
    if (body.evaluationQuestions !== undefined) {
      updateData.evaluation_questions = typeof body.evaluationQuestions === 'string'
        ? body.evaluationQuestions
        : JSON.stringify(body.evaluationQuestions);
    }

    const { data, error } = await supabaseAdmin
      .from('epreuves')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Supabase UPDATE error:', error);
      console.error('Updated fields:', JSON.stringify(updateData));
      return Response.json({
        error: error.message || 'Failed to update epreuve',
        details: error,
        updatedFields: updateData
      }, { status: 400 });
    }

    return Response.json(data);
  } catch (error) {
    console.error('PUT /epreuves/:id catch error:', error);
    return Response.json({ error: String(error), message: 'Failed to update epreuve' }, { status: 400 });
  }
}

// DELETE /api/epreuves/[id]
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
    console.error('DELETE /epreuves/:id error:', error);
    return Response.json({ error: 'Failed to delete epreuve' }, { status: 400 });
  }
}
