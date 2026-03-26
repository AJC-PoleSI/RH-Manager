import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';

// GET /api/members
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  try {
    const { data, error } = await supabaseAdmin
      .from('members')
      .select('id, email, is_admin');

    if (error) {
      return Response.json({ error: 'Failed to fetch members' }, { status: 500 });
    }

    return Response.json(data);
  } catch {
    return Response.json({ error: 'Failed to fetch members' }, { status: 500 });
  }
}

// POST /api/members (admin only)
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const body = await req.json();
    const { email, password, isAdmin } = body;

    if (!email || !password) {
      return Response.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Check for duplicate email
    const { data: existing } = await supabaseAdmin
      .from('members')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existing) {
      return Response.json({ error: 'Email already exists' }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const { data, error } = await supabaseAdmin
      .from('members')
      .insert({
        email,
        password_hash: passwordHash,
        is_admin: isAdmin || false,
      })
      .select('id, email, is_admin')
      .single();

    if (error) {
      return Response.json({ error: 'Failed to create member' }, { status: 400 });
    }

    return Response.json(data, { status: 201 });
  } catch {
    return Response.json({ error: 'Failed to create member' }, { status: 400 });
  }
}
