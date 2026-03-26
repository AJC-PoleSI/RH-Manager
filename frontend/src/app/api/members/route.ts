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
      .select('id, email, password_hash, is_admin, first_name, last_name, pole');

    if (error) {
      return Response.json({ error: 'Failed to fetch members' }, { status: 500 });
    }

    const mapped = (data || []).map((m: any) => ({
      id: m.id,
      email: m.email,
      password: m.password_hash ? '••••••' : '',
      isAdmin: m.is_admin,
      firstName: m.first_name || '',
      lastName: m.last_name || '',
      pole: m.pole || '',
    }));

    return Response.json(mapped);
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
    const { email, password, isAdmin, firstName, lastName, pole } = body;

    if (!email || !password) {
      return Response.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

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
        first_name: firstName || null,
        last_name: lastName || null,
        pole: pole || null,
      })
      .select('id, email, is_admin, first_name, last_name, pole')
      .single();

    if (error) {
      return Response.json({ error: 'Failed to create member' }, { status: 400 });
    }

    return Response.json({
      id: data.id,
      email: data.email,
      isAdmin: data.is_admin,
      firstName: data.first_name || '',
      lastName: data.last_name || '',
      pole: data.pole || '',
    }, { status: 201 });
  } catch {
    return Response.json({ error: 'Failed to create member' }, { status: 400 });
  }
}
