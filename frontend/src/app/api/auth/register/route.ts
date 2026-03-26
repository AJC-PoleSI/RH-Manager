import { supabaseAdmin } from '@/lib/supabase';
import { signToken } from '@/lib/auth';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { email, password, isAdmin } = await req.json();

    if (!email || !password) {
      return Response.json({ error: 'Email and password are required.' }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const { data: member, error } = await supabaseAdmin
      .from('members')
      .insert({
        email,
        password_hash: hashedPassword,
        is_admin: isAdmin || false,
      })
      .select('id, email, is_admin')
      .single();

    if (error) {
      // Supabase unique constraint violation
      if (error.code === '23505') {
        return Response.json(
          { error: 'Error creating member. Email might already exist.' },
          { status: 400 }
        );
      }
      return Response.json(
        { error: 'Error creating member. Email might already exist.', details: error.message },
        { status: 400 }
      );
    }

    return Response.json(
      { message: 'Member created successfully', member: { id: member.id, email: member.email } },
      { status: 201 }
    );
  } catch (error) {
    console.error('Register error:', error);
    return Response.json(
      { error: 'Error creating member.', details: String(error) },
      { status: 400 }
    );
  }
}
