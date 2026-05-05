import { supabaseAdmin } from '@/lib/supabase';
import { signToken } from '@/lib/auth';
import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { firstName, lastName, email, phone, dateOfBirth, formation, etablissement, anneeIntegration } = await req.json();

    if (!firstName || !lastName || !email || !dateOfBirth) {
      return Response.json(
        { error: 'Les champs Prénom, Nom, Email et Date de naissance sont obligatoires.' },
        { status: 400 }
      );
    }

    // Check registration window: ouverture = deadline_candidats, fermeture = deadline_membres
    const { data: windowSettings } = await supabaseAdmin
      .from('system_settings')
      .select('key, value')
      .in('key', ['deadline_candidats', 'deadline_membres']);

    const settingsMap: Record<string, string> = {};
    for (const row of windowSettings || []) settingsMap[row.key] = row.value;

    const parseDate = (val: string | undefined): Date | null => {
      if (!val || val.trim() === '') return null;
      let raw = val.trim();
      if (!raw.endsWith('Z') && !raw.match(/[+-]\d{2}:\d{2}$/)) raw += 'Z';
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    };

    const ouverture = parseDate(settingsMap['deadline_candidats']);
    const fermeture = parseDate(settingsMap['deadline_membres']);
    const now = new Date();

    if (ouverture && now < ouverture) {
      const formatted = ouverture.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
      return Response.json(
        { error: `Les inscriptions ne sont pas encore ouvertes. Ouverture le ${formatted}.` },
        { status: 403 }
      );
    }

    if (fermeture && now > fermeture) {
      const formatted = fermeture.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
      return Response.json(
        { error: `Les inscriptions sont fermées. La date limite était le ${formatted}.` },
        { status: 403 }
      );
    }

    // Create the candidate
    const { data: candidate, error } = await supabaseAdmin
      .from('candidates')
      .insert({
        first_name: firstName,
        last_name: lastName,
        email,
        phone: phone || null,
        date_of_birth: dateOfBirth,
        formation: formation || null,
        etablissement: etablissement || null,
        annee_integration: anneeIntegration || null,
      })
      .select('id, first_name, last_name, email, phone, date_of_birth')
      .single();

    if (error) {
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
