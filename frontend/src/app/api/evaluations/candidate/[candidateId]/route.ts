import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

// GET /api/evaluations/candidate/[candidateId] - Fetch evaluations for a candidate
// Returns individual evaluations + collective average per epreuve
export async function GET(
  req: NextRequest,
  { params }: { params: { candidateId: string } }
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const { candidateId } = params;

  // ── Permission : candidats ne peuvent pas voir les évaluations ──
  if (payload.role === 'candidate') {
    return forbidden();
  }

  // ── Membres : accès aux évaluations de tous les candidats ──

  try {
    const { data: evaluations, error } = await supabaseAdmin
      .from('candidate_evaluations')
      .select('*, epreuves(id, name, tour, type), members(id, email, first_name, last_name)')
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Parse scores and format each evaluation
    const parsed = (evaluations || []).map((e: any) => {
      const scores = typeof e.scores === 'string' ? JSON.parse(e.scores) : (e.scores || {});
      const scoreValues = Object.values(scores) as number[];
      const total = scoreValues.reduce((sum: number, v: number) => sum + v, 0);

      return {
        id: e.id,
        scores,
        scoreTotal: total,
        comment: e.comment,
        createdAt: e.created_at,
        epreuve: e.epreuves ? {
          id: e.epreuves.id,
          name: e.epreuves.name,
          tour: e.epreuves.tour,
          type: e.epreuves.type,
        } : null,
        member: e.members ? {
          id: e.members.id,
          email: e.members.email,
          firstName: e.members.first_name || '',
          lastName: e.members.last_name || '',
        } : null,
      };
    });

    // ── Calcul des notes collectives (moyenne) par épreuve ──
    const byEpreuve: Record<string, {
      epreuve: any;
      evaluations: typeof parsed;
      collectiveScore: number;
      evaluatorCount: number;
    }> = {};

    parsed.forEach(ev => {
      const epId = ev.epreuve?.id || 'unknown';
      if (!byEpreuve[epId]) {
        byEpreuve[epId] = {
          epreuve: ev.epreuve,
          evaluations: [],
          collectiveScore: 0,
          evaluatorCount: 0,
        };
      }
      byEpreuve[epId].evaluations.push(ev);
    });

    // Calculer la moyenne par épreuve
    Object.values(byEpreuve).forEach(group => {
      const totals = group.evaluations.map(e => e.scoreTotal);
      group.evaluatorCount = totals.length;
      group.collectiveScore = totals.length > 0
        ? Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * 10) / 10
        : 0;
    });

    return Response.json({
      evaluations: parsed,
      byEpreuve: Object.values(byEpreuve),
    });
  } catch (error) {
    console.error('Fetch candidate evaluations error:', error);
    return Response.json({ error: 'Failed to fetch evaluations' }, { status: 500 });
  }
}
