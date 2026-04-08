import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/candidates/[id]
export async function GET(req: NextRequest, context: RouteContext) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const { id } = await context.params;

  try {
    // ── Permission candidat : ne peut voir que SA propre fiche ──
    if (payload.role === 'candidate' && payload.id !== id) {
      return forbidden();
    }

    const { data, error } = await supabaseAdmin
      .from('candidates')
      .select('*, candidate_evaluations(*), candidate_wishes(id, pole, rank)')
      .eq('id', id)
      .single();

    if (error || !data) {
      return Response.json({ error: 'Candidate not found' }, { status: 404 });
    }

    // ── Membres : accès à toutes les fiches candidat ──
    // La restriction se fait au niveau de l'évaluation (seuls les assignés peuvent évaluer)

    // Map snake_case to camelCase
    const mapped: any = { ...data, firstName: data.first_name, lastName: data.last_name, createdAt: data.created_at };

    // Map wishes sorted by rank
    if (data.candidate_wishes) {
      mapped.wishes = (data.candidate_wishes as any[])
        .sort((a: any, b: any) => (a.rank || 99) - (b.rank || 99))
        .map((w: any) => ({ pole: w.pole, rank: w.rank }));
    } else {
      mapped.wishes = [];
    }

    // ── Candidat : retirer les évaluations et notes internes ──
    if (payload.role === 'candidate') {
      delete mapped.candidate_evaluations;
      delete mapped.comments;
    }

    return Response.json(mapped);
  } catch {
    return Response.json({ error: 'Failed to fetch candidate' }, { status: 500 });
  }
}

// PUT /api/candidates/[id]
// SECURITY: Candidates can only update their own profile; members/admins can update any
export async function PUT(req: NextRequest, context: RouteContext) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const { id } = await context.params;

  // SECURITY: Candidates can only modify their own data
  if (payload.role === 'candidate' && payload.id !== id) {
    return forbidden();
  }

  try {
    const body = await req.json();

    // Map camelCase to snake_case for Supabase
    const updateData: Record<string, unknown> = {};
    if (body.firstName !== undefined) updateData.first_name = body.firstName;
    if (body.lastName !== undefined) updateData.last_name = body.lastName;
    if (body.email !== undefined) updateData.email = body.email;
    if (body.phone !== undefined) updateData.phone = body.phone;
    if (body.date_of_birth !== undefined) updateData.date_of_birth = body.date_of_birth;
    if (body.dateOfBirth !== undefined) updateData.date_of_birth = body.dateOfBirth;

    // SECURITY: Only admins can update internal comments
    if (body.comments !== undefined && payload.isAdmin) {
      updateData.comments = body.comments;
    }

    const { data, error } = await supabaseAdmin
      .from('candidates')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return Response.json({ error: 'Failed to update candidate' }, { status: 400 });
    }

    return Response.json(data);
  } catch {
    return Response.json({ error: 'Failed to update candidate' }, { status: 400 });
  }
}

// DELETE /api/candidates/[id]
export async function DELETE(req: NextRequest, context: RouteContext) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  const { id } = await context.params;

  try {
    const { error } = await supabaseAdmin
      .from('candidates')
      .delete()
      .eq('id', id);

    if (error) {
      return Response.json({ error: 'Failed to delete candidate' }, { status: 400 });
    }

    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: 'Failed to delete candidate' }, { status: 400 });
  }
}
