import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized } from '@/lib/auth';
import { NextRequest } from 'next/server';

// GET /api/availability — get my availabilities (with optional ?start=&end= date filters)
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const memberId = payload.id;
  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start');
  const end = searchParams.get('end');

  try {
    let query = supabaseAdmin
      .from('availabilities')
      .select('*')
      .eq('member_id', memberId);

    if (start && end) {
      const startDate = new Date(start);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(end);
      endDate.setHours(23, 59, 59, 999);

      query = query
        .gte('date', startDate.toISOString())
        .lte('date', endDate.toISOString());
    }

    const { data, error } = await query;
    if (error) throw error;

    return Response.json(data);
  } catch (error) {
    return Response.json({ error: 'Failed to fetch availabilities' }, { status: 500 });
  }
}

// PUT /api/availability — bulk replace availabilities
export async function PUT(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const memberId = payload.id;

  try {
    // Check if saisie is open (non-admin members only)
    if (!payload.isAdmin) {
      const { data: settings } = await supabaseAdmin
        .from('system_settings')
        .select('value')
        .eq('key', 'saisie_dispos_ouverte')
        .single();

      if (!settings || settings.value !== 'true') {
        return Response.json(
          { error: 'La saisie des disponibilites est fermee. Contactez l\'administrateur.' },
          { status: 403 }
        );
      }
    }

    const { availabilities, startDate, endDate } = await req.json();

    // Anti-doublon: check no two availabilities overlap on the same weekday/time
    if (availabilities && availabilities.length > 0) {
      const seen = new Set<string>();
      for (const a of availabilities) {
        const key = `${a.weekday}-${a.startTime}`;
        if (seen.has(key)) {
          return Response.json(
            { error: `Doublon detecte : vous avez selectionne deux epreuves sur le meme creneau (${a.weekday} ${a.startTime}). Un membre ne peut pas etre a deux endroits en meme temps.` },
            { status: 400 }
          );
        }
        seen.add(key);
      }
    }

    if (startDate && endDate) {
      // Date-specific mode: delete only in this range, then create
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      const { error: deleteError } = await supabaseAdmin
        .from('availabilities')
        .delete()
        .eq('member_id', memberId)
        .gte('date', start.toISOString())
        .lte('date', end.toISOString());

      if (deleteError) throw deleteError;

      if (availabilities && availabilities.length > 0) {
        const rows = availabilities.map((a: any) => ({
          member_id: memberId,
          weekday: a.weekday,
          date: new Date(a.date).toISOString(),
          start_time: a.startTime,
          end_time: a.endTime,
        }));

        const { error: insertError } = await supabaseAdmin
          .from('availabilities')
          .insert(rows);

        if (insertError) throw insertError;
      }
    } else {
      // Legacy/generic mode: delete where date is null, then create
      const { error: deleteError } = await supabaseAdmin
        .from('availabilities')
        .delete()
        .eq('member_id', memberId)
        .is('date', null);

      if (deleteError) throw deleteError;

      if (availabilities && availabilities.length > 0) {
        const rows = availabilities.map((a: any) => ({
          member_id: memberId,
          weekday: a.weekday,
          date: null,
          start_time: a.startTime,
          end_time: a.endTime,
        }));

        const { error: insertError } = await supabaseAdmin
          .from('availabilities')
          .insert(rows);

        if (insertError) throw insertError;
      }
    }

    return Response.json({ message: 'Availabilities updated' });
  } catch (error) {
    console.error('Replace Availabilities Error:', error);
    return Response.json(
      { error: 'Failed to replace availabilities', details: String(error) },
      { status: 400 }
    );
  }
}

// POST /api/availability — add a single availability
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const memberId = payload.id;

  try {
    const { weekday, start_time, end_time } = await req.json();

    const { data, error } = await supabaseAdmin
      .from('availabilities')
      .insert({
        member_id: memberId,
        weekday,
        start_time,
        end_time,
      })
      .select()
      .single();

    if (error) throw error;

    return Response.json(data, { status: 201 });
  } catch (error) {
    return Response.json({ error: 'Failed to add availability' }, { status: 400 });
  }
}
