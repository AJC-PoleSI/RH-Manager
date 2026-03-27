import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized } from '@/lib/auth';
import { NextRequest } from 'next/server';

// GET /api/evaluations - Fetch evaluations (scoped by role)
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  // ── Candidats : pas d'accès aux évaluations ──
  if (payload.role === 'candidate') {
    return Response.json({ error: 'Acces interdit' }, { status: 403 });
  }

  try {
    let query = supabaseAdmin
      .from('candidate_evaluations')
      .select('*, epreuves(*), candidates(*), members(id, email, first_name, last_name)');

    // ── Membres non-admin : uniquement leurs propres évaluations ──
    if (!payload.isAdmin) {
      query = query.eq('member_id', payload.id);
    }

    const { data: evaluations, error } = await query;

    if (error) throw error;

    const parsed = (evaluations || []).map((e: any) => ({
      id: e.id,
      scores: typeof e.scores === 'string' ? JSON.parse(e.scores) : e.scores,
      comment: e.comment,
      createdAt: e.created_at,
      candidate: e.candidates ? {
        id: e.candidates.id,
        firstName: e.candidates.first_name,
        lastName: e.candidates.last_name,
      } : { id: '', firstName: '', lastName: '' },
      epreuve: e.epreuves ? {
        name: e.epreuves.name,
        tour: e.epreuves.tour,
        type: e.epreuves.type,
      } : { name: '', tour: 0, type: '' },
      member: e.members ? {
        id: e.members.id,
        firstName: e.members.first_name || '',
        lastName: e.members.last_name || '',
        email: e.members.email,
      } : null,
    }));

    return Response.json(parsed);
  } catch (error) {
    return Response.json({ error: 'Failed to fetch evaluations' }, { status: 500 });
  }
}

// POST /api/evaluations - Submit an evaluation
export async function POST(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();

  const memberId = user.id;

  try {
    const { candidateId, epreuveId, scores, comment } = await req.json();

    if (!candidateId || !epreuveId) {
      return Response.json({ error: 'candidateId et epreuveId requis' }, { status: 400 });
    }

    // ── GARDE 1 : Anti-répétition ──
    // Vérifie que ce membre n'a PAS déjà évalué ce candidat pour cette épreuve
    const { data: existingEval } = await supabaseAdmin
      .from('candidate_evaluations')
      .select('id')
      .eq('member_id', memberId)
      .eq('candidate_id', candidateId)
      .eq('epreuve_id', epreuveId)
      .limit(1);

    if (existingEval && existingEval.length > 0) {
      // Récupérer les noms pour le message d'erreur
      const [memberRes, candidateRes] = await Promise.all([
        supabaseAdmin.from('members').select('email, first_name, last_name').eq('id', memberId).single(),
        supabaseAdmin.from('candidates').select('first_name, last_name').eq('id', candidateId).single(),
      ]);
      const memberName = memberRes.data
        ? `${memberRes.data.first_name || ''} ${memberRes.data.last_name || ''}`.trim() || memberRes.data.email
        : 'Ce membre';
      const candidateName = candidateRes.data
        ? `${candidateRes.data.first_name || ''} ${candidateRes.data.last_name || ''}`.trim()
        : 'ce candidat';

      return Response.json(
        { error: `${memberName} a deja evalue le candidat ${candidateName} pour cette epreuve.` },
        { status: 409 }
      );
    }

    // ── GARDE 2 : Vérifier que le membre est assigné à un créneau pour cette épreuve ──
    // (Seuls les membres assignés via le planning ont le droit d'évaluer)
    // On vérifie qu'il existe un slot pour cette épreuve où ce membre est assigné
    if (!user.isAdmin) {
      const { data: assignments } = await supabaseAdmin
        .from('slot_member_assignments')
        .select('id, slot:evaluation_slots!inner(epreuve_id)')
        .eq('member_id', memberId)
        .eq('slot.epreuve_id', epreuveId)
        .limit(1);

      if (!assignments || assignments.length === 0) {
        return Response.json(
          { error: 'Vous n\'etes pas assigne a un creneau pour cette epreuve. Seuls les evaluateurs assignes via le planning peuvent soumettre une note.' },
          { status: 403 }
        );
      }
    }

    // ── GARDE 3 : Vérifier le nombre max d'évaluateurs (1-2) par candidat/épreuve ──
    const { data: existingEvals } = await supabaseAdmin
      .from('candidate_evaluations')
      .select('id')
      .eq('candidate_id', candidateId)
      .eq('epreuve_id', epreuveId);

    const maxEvaluators = 2; // Configurable : 1 ou 2 évaluateurs max par candidat/épreuve
    if (existingEvals && existingEvals.length >= maxEvaluators) {
      return Response.json(
        { error: `Ce candidat a deja ete evalue par ${maxEvaluators} evaluateur(s) pour cette epreuve. Nombre maximum atteint.` },
        { status: 409 }
      );
    }

    // ── Création de l'évaluation ──
    const { data: evaluation, error: evalError } = await supabaseAdmin
      .from('candidate_evaluations')
      .insert({
        candidate_id: candidateId,
        epreuve_id: epreuveId,
        member_id: memberId,
        scores: typeof scores === 'string' ? scores : JSON.stringify(scores),
        comment,
      })
      .select()
      .single();

    if (evalError) throw evalError;

    // Create evaluator tracking record
    const { error: trackError } = await supabaseAdmin
      .from('evaluator_tracking')
      .insert({
        member_id: memberId,
        candidate_id: candidateId,
        evaluation_id: evaluation.id,
      });

    if (trackError) {
      console.error('Failed to create evaluator tracking:', trackError);
    }

    return Response.json(evaluation, { status: 201 });
  } catch (error) {
    return Response.json({ error: 'Failed to submit evaluation' }, { status: 400 });
  }
}
