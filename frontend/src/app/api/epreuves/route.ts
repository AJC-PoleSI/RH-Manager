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

    // Parse evaluationQuestions from JSON string if stored as string
    const parsed = (epreuves || []).map((e) => ({
      ...e,
      evaluationQuestions:
        typeof e.evaluationQuestions === 'string'
          ? JSON.parse(e.evaluationQuestions || '[]')
          : e.evaluationQuestions ?? [],
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
        durationMinutes,
        evaluationQuestions:
          typeof evaluationQuestions === 'string'
            ? evaluationQuestions
            : JSON.stringify(evaluationQuestions ?? []),
        isPoleTest,
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
