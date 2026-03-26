import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized } from '@/lib/auth';
import { NextRequest } from 'next/server';

// GET /api/wishes/[candidateId] — get candidate wishes
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const { candidateId } = await params;

  try {
    const { data, error } = await supabaseAdmin
      .from('candidate_wishes')
      .select('*')
      .eq('candidate_id', candidateId)
      .order('rank', { ascending: true });

    if (error) throw error;

    return Response.json(data);
  } catch (error) {
    return Response.json({ error: 'Failed to fetch wishes' }, { status: 500 });
  }
}

// PUT /api/wishes/[candidateId] — replace all wishes for a candidate
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const { candidateId } = await params;

  try {
    const { wishes } = await req.json();

    if (!Array.isArray(wishes)) {
      return Response.json({ error: 'wishes must be an array' }, { status: 400 });
    }

    // Delete existing wishes
    const { error: deleteError } = await supabaseAdmin
      .from('candidate_wishes')
      .delete()
      .eq('candidate_id', candidateId);

    if (deleteError) throw deleteError;

    // Insert new wishes
    if (wishes.length > 0) {
      const rows = wishes.map((w: { pole: string; rank: number }) => ({
        candidate_id: candidateId,
        pole: w.pole,
        rank: w.rank,
      }));

      const { error: insertError } = await supabaseAdmin
        .from('candidate_wishes')
        .insert(rows);

      if (insertError) throw insertError;
    }

    // Return updated wishes
    const { data: updated, error: fetchError } = await supabaseAdmin
      .from('candidate_wishes')
      .select('*')
      .eq('candidate_id', candidateId)
      .order('rank', { ascending: true });

    if (fetchError) throw fetchError;

    return Response.json(updated);
  } catch (error) {
    return Response.json({ error: 'Failed to save wishes' }, { status: 500 });
  }
}
