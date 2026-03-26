import { supabaseAdmin } from '@/lib/supabase';
import { NextRequest } from 'next/server';

// GET /api/deliberations - Fetch all deliberations with candidate info
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tour = searchParams.get('tour');

    // Fetch candidates with their deliberation and evaluations
    const { data: candidates, error } = await supabaseAdmin
      .from('candidates')
      .select(`
        id,
        first_name,
        last_name,
        email,
        phone,
        comments,
        deliberations(*),
        candidate_evaluations(
          id,
          scores,
          comment,
          member_id,
          created_at,
          members(email),
          epreuves(id, name, tour, type)
        )
      `)
      .order('last_name', { ascending: true });

    if (error) throw error;

    // If tour filter is specified, filter evaluations client-side
    const result = (candidates || []).map((c) => {
      let evaluations = c.candidate_evaluations || [];

      if (tour) {
        const tourNum = parseInt(tour);
        evaluations = evaluations.filter(
          (ev: any) => ev.epreuves?.tour === tourNum
        );
      }

      // Parse scores
      evaluations = evaluations.map((ev: any) => ({
        ...ev,
        scores:
          typeof ev.scores === 'string' ? JSON.parse(ev.scores) : ev.scores,
      }));

      return {
        id: c.id,
        firstName: c.first_name,
        lastName: c.last_name,
        email: c.email,
        phone: c.phone,
        comments: c.comments,
        deliberation: Array.isArray(c.deliberations)
          ? c.deliberations[0] || null
          : c.deliberations,
        evaluations,
      };
    });

    return Response.json(result);
  } catch (error) {
    console.error('getAllDeliberations error:', error);
    return Response.json(
      { error: 'Failed to fetch deliberation data' },
      { status: 500 }
    );
  }
}
