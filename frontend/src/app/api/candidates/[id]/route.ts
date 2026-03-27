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
      .select('*, candidate_evaluations(*)')
      .eq('id', id)
      .single();

    if (error || !data) {
      return Response.json({ error: 'Candidate not found' }, { status: 404 });
    }

    // ── Permission membre non-admin : vérifier qu'il est assigné à évaluer ce candidat ──
    if (payload.role === 'member' && !payload.isAdmin) {
      const { data: assignments } = await supabaseAdmin
        .from('slot_member_assignments')
        .select('slot:evaluation_slots!inner(enrollments:slot_enrollments!inner(candidate_id))')
        .eq('member_id', payload.id)
        .eq('slot.enrollments.candidate_id', id)
        .limit(1);

      if (!assignments || assignments.length === 0) {
        return forbidden();
      }
    }

    // Map snake_case to camelCase
    const mapped: any = { ...data, firstName: data.first_name, lastName: data.last_name, createdAt: data.created_at };

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
export async function PUT(req: NextRequest, context: RouteContext) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const { id } = await context.params;

  try {
    const body = await req.json();

    // Map camelCase to snake_case for Supabase
    const updateData: Record<string, unknown> = {};
    if (body.firstName !== undefined) updateData.first_name = body.firstName;
    if (body.lastName !== undefined) updateData.last_name = body.lastName;
    if (body.email !== undefined) updateData.email = body.email;
    if (body.phone !== undefined) updateData.phone = body.phone;
    if (body.comments !== undefined) updateData.comments = body.comments;
    if (body.date_of_birth !== undefined) updateData.date_of_birth = body.date_of_birth;
    if (body.dateOfBirth !== undefined) updateData.date_of_birth = body.dateOfBirth;

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
