import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';

// GET /api/epreuves - Proxy to Express backend
export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get('authorization') || '';

    const backendRes = await fetch(`${BACKEND_URL}/api/epreuves`, {
      headers: {
        'Authorization': token,
      },
    });

    const data = await backendRes.json().catch(() => []);

    if (!backendRes.ok) {
      return Response.json(
        data || { error: 'Backend error' },
        { status: backendRes.status }
      );
    }

    // Map snake_case fields from Express/Prisma to camelCase for frontend compatibility
    const parsed = (Array.isArray(data) ? data : []).map((e: any) => ({
      id: e.id,
      name: e.name,
      tour: e.tour,
      tourName: `Tour ${e.tour}`,
      type: e.type,
      durationMinutes: e.durationMinutes ?? e.duration_minutes,
      evaluationQuestions:
        typeof e.evaluationQuestions === 'string'
          ? (() => { try { return JSON.parse(e.evaluationQuestions); } catch { return []; } })()
          : e.evaluationQuestions ?? [],
      roulementMinutes: e.roulementMinutes ?? e.roulement_minutes ?? 10,
      nbSalles: e.nbSalles ?? e.nb_salles ?? 1,
      minEvaluatorsPerSalle: e.minEvaluatorsPerSalle ?? e.min_evaluators_per_salle ?? 2,
      isPoleTest: e.isPoleTest ?? e.is_pole_test ?? false,
      pole: e.pole || null,
      isGroupEpreuve: e.isGroupEpreuve ?? e.is_group_epreuve ?? false,
      groupSize: e.groupSize ?? e.group_size ?? 1,
      isCommune: e.type === 'commune',
      description: e.description || null,
      documentsUrls: e.documentsUrls ?? e.documents_urls ?? [],
      date: e.date || null,
      time: e.time || null,
      salle: e.salle || null,
      presentedBy: e.presentedBy ?? e.presented_by ?? null,
      dateDebut: e.dateDebut ?? e.date_debut ?? null,
      dateFin: e.dateFin ?? e.date_fin ?? null,
      isVisible: e.isVisible !== undefined ? e.isVisible : (e.is_visible !== false),
    }));

    return Response.json(parsed);
  } catch (error) {
    console.error('Proxy GET /epreuves error:', error);
    return Response.json({ error: 'Failed to fetch epreuves' }, { status: 500 });
  }
}

// POST /api/epreuves - Proxy to Express backend  
export async function POST(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  try {
    const body = await req.json();
    const token = req.headers.get('authorization') || '';

    const backendRes = await fetch(`${BACKEND_URL}/api/epreuves`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token,
      },
      body: JSON.stringify(body),
    });

    const data = await backendRes.json().catch(() => ({}));

    if (!backendRes.ok) {
      return Response.json(
        data || { error: 'Backend error' },
        { status: backendRes.status }
      );
    }

    return Response.json(data, { status: 201 });
  } catch (error) {
    console.error('Proxy POST /epreuves error:', error);
    return Response.json({ error: 'Failed to create epreuve' }, { status: 400 });
  }
}
