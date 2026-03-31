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
      tourName: `Tour ${e.tour}`,
      type: e.type,
      durationMinutes: e.duration_minutes,
      evaluationQuestions:
        typeof e.evaluation_questions === 'string'
          ? JSON.parse(e.evaluation_questions || '[]')
          : e.evaluation_questions ?? [],
      roulementMinutes: e.roulement_minutes || 10,
      nbSalles: e.nb_salles || 1,
      minEvaluatorsPerSalle: e.min_evaluators_per_salle || 2,
      isPoleTest: e.is_pole_test,
      pole: e.pole,
      isGroupEpreuve: e.is_group_epreuve,
      groupSize: e.group_size,
      isCommune: e.type === 'commune',
      description: e.description || null,
      documentsUrls: e.documents_urls || [],
      // Champs date/logistique
      date: e.date || null,
      time: e.time || null,
      salle: e.salle || null,
      presentedBy: e.presented_by || null,
      dateDebut: e.date_debut || null,
      dateFin: e.date_fin || null,
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
    const body = await req.json();

    // Support both formats: settings page (tourId, criteres, duree) and epreuves page (tour, durationMinutes, evaluationQuestions)
    const tourValue = body.tour ?? (body.tourId ? parseInt(body.tourId) : 1);
    const durationValue = body.durationMinutes ?? (body.duree ? parseInt(body.duree) : 30);
    const roulementValue = body.roulementMinutes ?? 10;
    const nbSallesValue = body.nbSalles ?? 1;
    const minEvaluatorsValue = body.minEvaluatorsPerSalle ?? 2;
    const questionsValue = body.evaluationQuestions ?? body.criteres?.map((c: any) => ({ q: c.name, weight: c.coefficient })) ?? [];
    const isPoleTest = body.isPoleTest ?? (body.pole ? true : false);

    // Core fields (always exist in DB)
    const coreData: Record<string, unknown> = {
        name: body.name,
        tour: tourValue,
        type: body.type,
        duration_minutes: durationValue,
        evaluation_questions:
          typeof questionsValue === 'string'
            ? questionsValue
            : JSON.stringify(questionsValue),
        is_pole_test: isPoleTest,
        pole: body.pole || null,
    };

    // Extended fields (may not exist if migration not run yet)
    const extendedFields: Record<string, unknown> = {};
    if (roulementValue !== undefined) extendedFields.roulement_minutes = roulementValue;
    if (nbSallesValue !== undefined) extendedFields.nb_salles = nbSallesValue;
    if (minEvaluatorsValue !== undefined) extendedFields.min_evaluators_per_salle = minEvaluatorsValue;
    if (body.description) extendedFields.description = body.description;
    if (body.documentsUrls && body.documentsUrls.length > 0) extendedFields.documents_urls = body.documentsUrls;
    if (body.date) extendedFields.date = body.date;
    if (body.time) extendedFields.time = body.time;
    if (body.salle) extendedFields.salle = body.salle;
    if (body.presentedBy) extendedFields.presented_by = body.presentedBy;
    if (body.dateDebut) extendedFields.date_debut = body.dateDebut;
    if (body.dateFin) extendedFields.date_fin = body.dateFin;

    // Try with all fields first, fallback to core only if columns don't exist
    let epreuve: any;
    let error: any;

    const fullInsert = await supabaseAdmin
      .from('epreuves')
      .insert({ ...coreData, ...extendedFields })
      .select()
      .single();

    if (fullInsert.error && String(fullInsert.error.message).includes('column')) {
      // Fallback: insert with core fields only
      const fallback = await supabaseAdmin
        .from('epreuves')
        .insert(coreData)
        .select()
        .single();
      epreuve = fallback.data;
      error = fallback.error;
    } else {
      epreuve = fullInsert.data;
      error = fullInsert.error;
    }

    if (error) throw error;

    // ══════════════════════════════════════════════════════════════════
    // ÉPREUVE COMMUNE / SUR TABLE : Créer un événement calendrier global
    // Visible par TOUS les utilisateurs (member_id et candidate_id = null)
    // ══════════════════════════════════════════════════════════════════
    if (body.type === 'commune' && body.date) {
      const calendarEvent = {
        title: `${body.name} (Sur table)`,
        description: `Épreuve commune — Tour ${tourValue}${body.salle ? ` — Salle : ${body.salle}` : ''}${body.presentedBy ? ` — Présenté par : ${body.presentedBy}` : ''}`,
        day: new Date(body.date + 'T12:00:00').toISOString(),
        start_time: body.time || '09:00',
        end_time: body.time
          ? (() => { const [h, m] = body.time.split(':').map(Number); const t = h * 60 + (m || 0) + durationValue; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; })()
          : '10:00',
        related_epreuve_id: epreuve.id,
        related_member_id: null,
        related_candidate_id: null,
        is_global: true,
      };

      const { error: calError } = await supabaseAdmin
        .from('calendar_events')
        .insert(calendarEvent);

      if (calError) {
        console.error('Erreur creation evenement calendrier global:', calError);
      }
    }

    return Response.json(epreuve, { status: 201 });
  } catch (error) {
    return Response.json({ error: 'Failed to create epreuve' }, { status: 400 });
  }
}
