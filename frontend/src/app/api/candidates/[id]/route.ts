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
    const { data, error } = await supabaseAdmin
      .from('candidates')
      .select('*, candidate_evaluations(*)')
      .eq('id', id)
      .single();

    if (error || !data) {
      return Response.json({ error: 'Candidate not found' }, { status: 404 });
    }

    // Map snake_case to camelCase
    const mapped = { ...data, firstName: data.first_name, lastName: data.last_name, createdAt: data.created_at };
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
