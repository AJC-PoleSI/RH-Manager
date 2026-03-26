import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/members/[id]
export async function GET(req: NextRequest, context: RouteContext) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const { id } = await context.params;

  try {
    const { data, error } = await supabaseAdmin
      .from('members')
      .select('id, email, is_admin')
      .eq('id', id)
      .single();

    if (error || !data) {
      return Response.json({ error: 'Member not found' }, { status: 404 });
    }

    return Response.json(data);
  } catch {
    return Response.json({ error: 'Failed to fetch member' }, { status: 500 });
  }
}

// PUT /api/members/[id] (admin only)
export async function PUT(req: NextRequest, context: RouteContext) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  const { id } = await context.params;

  try {
    const body = await req.json();
    const { email, password, isAdmin } = body;

    const updateData: Record<string, unknown> = {};
    if (email !== undefined) updateData.email = email;
    if (isAdmin !== undefined) updateData.is_admin = isAdmin;
    if (password) {
      updateData.password_hash = await bcrypt.hash(password, 10);
    }

    const { data, error } = await supabaseAdmin
      .from('members')
      .update(updateData)
      .eq('id', id)
      .select('id, email, is_admin')
      .single();

    if (error) {
      return Response.json({ error: 'Failed to update member' }, { status: 400 });
    }

    return Response.json(data);
  } catch {
    return Response.json({ error: 'Failed to update member' }, { status: 400 });
  }
}

// DELETE /api/members/[id] (admin only)
export async function DELETE(req: NextRequest, context: RouteContext) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  const { id } = await context.params;

  try {
    const { error } = await supabaseAdmin
      .from('members')
      .delete()
      .eq('id', id);

    if (error) {
      return Response.json({ error: 'Failed to delete member' }, { status: 400 });
    }

    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: 'Failed to delete member' }, { status: 400 });
  }
}
