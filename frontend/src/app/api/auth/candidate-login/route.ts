import { supabaseAdmin } from '@/lib/supabase';
import { signToken } from '@/lib/auth';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { email, lastName } = await req.json();

    if (!email || !lastName) {
      return Response.json({ error: 'Email et nom requis.' }, { status: 400 });
    }

    const { data: candidate, error } = await supabaseAdmin
      .from('candidates')
      .select('id, first_name, last_name, email, phone')
      .eq('email', email)
      .single();

    if (error || !candidate) {
      return Response.json(
        { error: 'Candidat introuvable ou nom incorrect.' },
        { status: 401 }
      );
    }

    if (candidate.last_name.toLowerCase() !== lastName.toLowerCase()) {
      return Response.json(
        { error: 'Candidat introuvable ou nom incorrect.' },
        { status: 401 }
      );
    }

    const token = signToken({
      id: candidate.id,
      email: candidate.email,
      role: 'candidate',
    });

    return Response.json({ token, candidate });
  } catch (error) {
    console.error('Candidate login error:', error);
    return Response.json({ error: 'Erreur de connexion candidat.' }, { status: 500 });
  }
}
