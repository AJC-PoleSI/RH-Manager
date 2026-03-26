import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized } from '@/lib/auth';
import { NextRequest } from 'next/server';

// GET /api/calendar — get events with optional ?start=&end= date filters
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start');
  const end = searchParams.get('end');

  try {
    let query = supabaseAdmin
      .from('calendar_events')
      .select(`
        *,
        epreuve:epreuves(*),
        member:members(email),
        candidate:candidates(first_name, last_name)
      `);

    if (start && end) {
      const endDate = new Date(end);
      endDate.setHours(23, 59, 59, 999);

      query = query
        .gte('day', new Date(start).toISOString())
        .lte('day', endDate.toISOString());
    }

    const { data, error } = await query;
    if (error) throw error;

    return Response.json(data);
  } catch (error) {
    return Response.json({ error: 'Failed to fetch events' }, { status: 500 });
  }
}

// POST /api/calendar — create a calendar event
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  try {
    const {
      title, description, day,
      start_time, end_time, startTime, endTime,
      related_epreuve_id, related_member_id, related_candidate_id,
    } = await req.json();

    const { data, error } = await supabaseAdmin
      .from('calendar_events')
      .insert({
        title,
        description,
        day: new Date(day).toISOString(),
        start_time: start_time || startTime,
        end_time: end_time || endTime,
        related_epreuve_id,
        related_member_id,
        related_candidate_id,
      })
      .select()
      .single();

    if (error) throw error;

    return Response.json(data, { status: 201 });
  } catch (error) {
    console.error('Create event error:', error);
    return Response.json(
      { error: 'Failed to create event', details: String(error) },
      { status: 400 }
    );
  }
}
