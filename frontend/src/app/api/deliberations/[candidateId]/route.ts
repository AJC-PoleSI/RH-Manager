import { supabaseAdmin } from '@/lib/supabase';
import { NextRequest } from 'next/server';

// GET /api/deliberations/[candidateId] - Fetch deliberation for a candidate
export async function GET(
  req: NextRequest,
  { params }: { params: { candidateId: string } }
) {
  const { candidateId } = params;

  try {
    const { data: deliberation, error } = await supabaseAdmin
      .from('deliberations')
      .select('*')
      .eq('candidate_id', candidateId)
      .maybeSingle();

    if (error) throw error;

    return Response.json(deliberation || { status: 'No deliberation yet' });
  } catch (error) {
    return Response.json({ error: 'Failed to fetch deliberation' }, { status: 500 });
  }
}

// PUT /api/deliberations/[candidateId] - Create or update deliberation
export async function PUT(
  req: NextRequest,
  { params }: { params: { candidateId: string } }
) {
  const { candidateId } = params;

  try {
    const { tour1Status, tour2Status, tour3Status, globalComments, prosComment, consComment } =
      await req.json();

    // Build update data with snake_case for Supabase
    const updateData: Record<string, unknown> = {};
    if (tour1Status !== undefined) updateData.tour1_status = tour1Status;
    if (tour2Status !== undefined) updateData.tour2_status = tour2Status;
    if (tour3Status !== undefined) updateData.tour3_status = tour3Status;
    if (globalComments !== undefined) updateData.global_comments = globalComments;
    if (prosComment !== undefined) updateData.pros_comment = prosComment;
    if (consComment !== undefined) updateData.cons_comment = consComment;

    // Check if deliberation exists
    const { data: existing } = await supabaseAdmin
      .from('deliberations')
      .select('id')
      .eq('candidate_id', candidateId)
      .maybeSingle();

    let deliberation;

    if (existing) {
      // Update existing
      const { data, error } = await supabaseAdmin
        .from('deliberations')
        .update(updateData)
        .eq('candidate_id', candidateId)
        .select()
        .single();

      if (error) throw error;
      deliberation = data;
    } else {
      // Create new
      const { data, error } = await supabaseAdmin
        .from('deliberations')
        .insert({ candidate_id: candidateId, ...updateData })
        .select()
        .single();

      if (error) throw error;
      deliberation = data;
    }

    return Response.json(deliberation);
  } catch (error) {
    console.error('updateDeliberation error:', error);
    return Response.json(
      { error: 'Failed to update deliberation' },
      { status: 400 }
    );
  }
}
