import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

// POST /api/slots — create a slot (admin)
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const {
      date, startTime, endTime, durationMinutes,
      label, maxCandidates, minMembers, simultaneousSlots,
      epreuveId, tour, room,
    } = await req.json();

    if (!date || !startTime || !endTime) {
      return Response.json(
        { error: 'date, startTime, endTime are required' },
        { status: 400 }
      );
    }

    const { data: slot, error } = await supabaseAdmin
      .from('evaluation_slots')
      .insert({
        date: new Date(date + 'T12:00:00').toISOString(),
        start_time: startTime,
        end_time: endTime,
        duration_minutes: durationMinutes || 60,
        label: label || null,
        max_candidates: maxCandidates || 1,
        min_members: minMembers || 1,
        simultaneous_slots: simultaneousSlots ?? 1,
        epreuve_id: epreuveId || null,
        tour: tour || 1,
        room: room || null,
        status: 'open',
      })
      .select(`
        *,
        epreuve:epreuves(name, tour, type),
        members:slot_member_assignments(*, member:members(id, email)),
        enrollments:slot_enrollments(*, candidate:candidates(id, first_name, last_name)),
        requests:slot_availability_requests(*, member:members(id, email))
      `)
      .single();

    if (error) throw error;

    return Response.json(slot, { status: 201 });
  } catch (error) {
    console.error('Create slot error:', error);
    return Response.json(
      { error: 'Failed to create slot', details: String(error) },
      { status: 500 }
    );
  }
}
