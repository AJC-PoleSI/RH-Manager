import { supabaseAdmin } from '@/lib/supabase';
import { signToken } from '@/lib/auth';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return Response.json({ error: 'Email and password are required.' }, { status: 400 });
    }

    const { data: member, error } = await supabaseAdmin
      .from('members')
      .select('id, email, password_hash, is_admin')
      .eq('email', email)
      .single();

    if (error || !member) {
      return Response.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const validPassword = await bcrypt.compare(password, member.password_hash);

    if (!validPassword) {
      return Response.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const token = signToken({
      id: member.id,
      email: member.email,
      role: 'member',
      isAdmin: member.is_admin,
    });

    return Response.json({
      token,
      member: { id: member.id, email: member.email, isAdmin: member.is_admin },
    });
  } catch (error) {
    console.error('Login error:', error);
    return Response.json({ error: 'Login failed' }, { status: 500 });
  }
}
