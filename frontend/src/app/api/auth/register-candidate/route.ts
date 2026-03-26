import { supabaseAdmin } from '@/lib/supabase';
import { signToken } from '@/lib/auth';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { firstName, lastName, email, phone } = await req.json();

    if (!firstName || !lastName || !email) {
      return Response.json(
        { error: 'Les champs Prénom, Nom et Email sont obligatoires.' },
        { status: 400 }
      );
    }

    // Check if registration is still open (optional deadline check)
    const { data: deadlineSetting } = await supabaseAdmin
      .from('system_settings')
      .select('value')
      .eq('key', 'deadline_candidats')
      .single();

    if (deadlineSetting?.value) {
      const deadline = new Date(deadlineSetting.value);
      if (new Date() > deadline) {
        return Response.json(
          { error: 'Les inscriptions sont fermées. La date limite est dépassée.' },
          { status: 403 }
        );
      }
    }

    // Create the candidate
    const { data: candidate, error } = await supabaseAdmin
      .from('candidates')
      .insert({
        first_name: firstName,
        last_name: lastName,
        email,
        phone: phone || null,
      })
      .select('id, first_name, last_name, email, phone')
      .single();

    if (error) {
      // Supabase unique constraint violation
      if (error.code === '23505') {
        return Response.json(
          { error: 'Un candidat avec cet email existe déjà. Utilisez "Se connecter" à la place.' },
          { status: 400 }
        );
      }
      return Response.json(
        { error: "Échec de l'inscription.", details: error.message },
        { status: 400 }
      );
    }

    // Generate token immediately
    const token = signToken({
      id: candidate.id,
      email: candidate.email,
      role: 'candidate',
    });

    return Response.json({ token, candidate }, { status: 201 });
  } catch (error) {
    console.error('registerCandidate error:', error);
    return Response.json(
      { error: "Échec de l'inscription.", details: String(error) },
      { status: 400 }
    );
  }
}
