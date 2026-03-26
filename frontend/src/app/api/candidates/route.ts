import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

// GET /api/candidates?search=&limit=&page=
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const { searchParams } = req.nextUrl;
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const search = searchParams.get('search') || '';
  const offset = (page - 1) * limit;

  try {
    let query = supabaseAdmin
      .from('candidates')
      .select('*, candidate_evaluations(*, members(email))', { count: 'exact' })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.or(
        `first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`
      );
    }

    const { data, error, count } = await query;

    if (error) {
      return Response.json({ error: 'Failed to fetch candidates' }, { status: 500 });
    }

    const total = count ?? 0;

    // Map snake_case to camelCase for frontend
    const mapped = (data || []).map((c: any) => ({
      ...c,
      firstName: c.first_name,
      lastName: c.last_name,
      createdAt: c.created_at,
    }));

    return Response.json({
      data: mapped,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch {
    return Response.json({ error: 'Failed to fetch candidates' }, { status: 500 });
  }
}

// POST /api/candidates
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  try {
    const body = await req.json();
    const { firstName, lastName, email, phone } = body;

    if (!firstName || !lastName || !email) {
      return Response.json(
        { error: 'Les champs Prénom, Nom et Email sont obligatoires.' },
        { status: 400 }
      );
    }

    // Check for duplicate email
    const { data: existing } = await supabaseAdmin
      .from('candidates')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existing) {
      return Response.json(
        { error: 'Un candidat avec cet email existe déjà.' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('candidates')
      .insert({
        first_name: firstName,
        last_name: lastName,
        email,
        phone: phone || null,
      })
      .select()
      .single();

    if (error) {
      return Response.json(
        { error: 'Échec de la création du candidat.', details: error.message },
        { status: 400 }
      );
    }

    return Response.json(data, { status: 201 });
  } catch {
    return Response.json(
      { error: 'Échec de la création du candidat.' },
      { status: 400 }
    );
  }
}
