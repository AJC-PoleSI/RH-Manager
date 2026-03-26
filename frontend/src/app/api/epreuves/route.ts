import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

// GET /api/epreuves - Fetch all epreuves
export async function GET() {
  try {
    const { data: epreuves, error } = await supabaseAdmin
      .from('epreuves')
      .select('*');

    if (error) throw error;

    // Map snake_case DB columns to camelCase for frontend
    const parsed = (epreuves || []).map((e: any) => ({
      id: e.id,
      name: e.name,
      tour: e.tour,
      type: e.type,
      durationMinutes: e.duration_minutes,
      evaluationQuestions:
        typeof e.evaluation_questions === 'string'
          ? JSON.parse(e.evaluation_questions || '[]')
          : e.evaluation_questions ?? [],
      isPoleTest: e.is_pole_test,
      pole: e.pole,
      isGroupEpreuve: e.is_group_epreuve,
      groupSize: e.group_size,
    }));

    return Response.json(parsed);
  } catch (error) {
    return Response.json({ error: 'Failed to fetch epreuves' }, { status: 500 });
  }
}

// POST /api/epreuves - Create an epreuve (admin only)
export async function POST(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  try {
    const { name, tour, type, durationMinutes, evaluationQuestions, isPoleTest, pole } =
      await req.json();

    const { data: epreuve, error } = await supabaseAdmin
      .from('epreuves')
      .insert({
        name,
        tour,
        type,
        duration_minutes: durationMinutes,
        evaluation_questions:
          typeof evaluationQuestions === 'string'
            ? evaluationQuestions
            : JSON.stringify(evaluationQuestions ?? []),
        is_pole_test: isPoleTest,
        pole,
      })
      .select()
      .single();

    if (error) throw error;

    return Response.json(epreuve, { status: 201 });
  } catch (error) {
    return Response.json({ error: 'Failed to create epreuve' }, { status: 400 });
  }
}
