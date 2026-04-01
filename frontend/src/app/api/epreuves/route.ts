import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

// GET /api/epreuves
export async function GET(req: NextRequest) {
  try {
    const { data, error } = await supabaseAdmin
      .from('epreuves')
      .select('*')
      .order('tour', { ascending: true });

    if (error) throw error;

    const parsed = (data || []).map((e: any) => ({
      id: e.id,
      name: e.name,
      tour: e.tour,
      tourName: `Tour ${e.tour}`,
      type: e.type,
      durationMinutes: e.duration_minutes,
      evaluationQuestions:
        typeof e.evaluation_questions === 'string'
          ? (() => { try { return JSON.parse(e.evaluation_questions); } catch { return []; } })()
          : e.evaluation_questions ?? [],
      roulementMinutes: e.roulement_minutes ?? 10,
      nbSalles: e.nb_salles ?? 1,
      minEvaluatorsPerSalle: e.min_evaluators_per_salle ?? 2,
      isPoleTest: e.is_pole_test ?? false,
      pole: e.pole || null,
      isGroupEpreuve: e.is_group_epreuve ?? false,
      groupSize: e.group_size ?? 1,
      isCommune: e.type === 'commune',
      description: e.description || null,
      dateDebut: e.date_debut || null,
      dateFin: e.date_fin || null,
      isVisible: e.is_visible !== false,
    }));

    return Response.json(parsed);
  } catch (error) {
    console.error('GET /epreuves error:', error);
    return Response.json({ error: 'Failed to fetch epreuves' }, { status: 500 });
  }
}

// POST /api/epreuves
export async function POST(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  try {
    const body = await req.json();

    const insertData: any = {
      name: body.name,
      tour: body.tour ?? 1,
      type: body.type ?? 'commune',
      duration_minutes: body.durationMinutes ?? 30,
      evaluation_questions: typeof body.evaluationQuestions === 'string'
        ? body.evaluationQuestions
        : JSON.stringify(body.evaluationQuestions ?? []),
      is_pole_test: body.isPoleTest ?? false,
      pole: body.pole || null,
      roulement_minutes: body.roulementMinutes ?? 10,
      nb_salles: body.nbSalles ?? 1,
      min_evaluators_per_salle: body.minEvaluatorsPerSalle ?? 2,
      date_debut: body.dateDebut || null,
      date_fin: body.dateFin || null,
      description: body.description || null,
      is_visible: body.isVisible !== undefined ? body.isVisible : true,
    };

    const { data, error } = await supabaseAdmin
      .from('epreuves')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error('Supabase INSERT error:', error);
      return Response.json({ error: error.message || 'Failed to create epreuve', details: error }, { status: 400 });
    }

    return Response.json(data, { status: 201 });
  } catch (error) {
    console.error('POST /epreuves catch error:', error);
    return Response.json({ error: String(error), message: 'Failed to create epreuve' }, { status: 400 });
  }
}
