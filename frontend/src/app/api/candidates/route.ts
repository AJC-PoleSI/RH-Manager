import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

// GET /api/candidates?search=&limit=&page=
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  // ── Permission : candidats ne peuvent pas voir la liste ──
  if (payload.role === 'candidate') {
    return Response.json({ error: 'Acces interdit aux candidats' }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const search = searchParams.get('search') || '';
  const offset = (page - 1) * limit;

  try {
    // ── Membres non-admin : uniquement les candidats qu'ils doivent évaluer ──
    let allowedCandidateIds: string[] | null = null;
    if (!payload.isAdmin) {
      const { data: assignments } = await supabaseAdmin
        .from('slot_member_assignments')
        .select('slot:evaluation_slots!inner(enrollments:slot_enrollments(candidate_id))')
        .eq('member_id', payload.id);

      const ids = new Set<string>();
      (assignments || []).forEach((a: any) => {
        const enrollments = a.slot?.enrollments || [];
        enrollments.forEach((e: any) => {
          if (e.candidate_id) ids.add(e.candidate_id);
        });
      });
      allowedCandidateIds = Array.from(ids);

      if (allowedCandidateIds.length === 0) {
        return Response.json({
          data: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
        });
      }
    }

    let query = supabaseAdmin
      .from('candidates')
      .select('*, candidate_evaluations(*, members(email))', { count: 'exact' })
      .range(offset, offset + limit - 1);

    // Filtrer par candidats autorisés pour les membres
    if (allowedCandidateIds) {
      query = query.in('id', allowedCandidateIds);
    }

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
    const { firstName, lastName, email, phone, dateOfBirth } = body;

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
        date_of_birth: dateOfBirth || null,
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
