import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized } from '@/lib/auth';
import { NextRequest } from 'next/server';

// GET /api/slots/available — published/ready slots for candidate enrollment
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const candidateId = payload.id;

  try {
    const { data: slots, error } = await supabaseAdmin
      .from('evaluation_slots')
      .select(`
        *,
        epreuve:epreuves(id, name, tour, type, duration_minutes, is_group_epreuve, group_size),
        enrollments:slot_enrollments(candidate_id),
        members:slot_member_assignments(id)
      `)
      .in('status', ['published', 'ready'])
      .order('date', { ascending: true })
      .order('start_time', { ascending: true });

    if (error) throw error;

    // Map slots — published/ready status already guarantees visibility
    const available = (slots || [])
      .map((slot: any) => {
        const enrolledCount = slot.enrollments?.length || 0;
        const isFull = enrolledCount >= slot.max_candidates;
        const isEnrolled = payload.role === 'candidate'
          ? slot.enrollments?.some((e: any) => e.candidate_id === candidateId)
          : false;

        return {
          id: slot.id,
          epreuve: slot.epreuve ? {
            id: slot.epreuve.id,
            name: slot.epreuve.name,
            tour: slot.epreuve.tour,
            type: slot.epreuve.type,
            durationMinutes: slot.epreuve.duration_minutes,
          } : null,
          date: slot.date,
          startTime: slot.start_time,
          endTime: slot.end_time,
          durationMinutes: slot.duration_minutes,
          label: slot.label,
          room: slot.room || null,
          tour: slot.tour,
          maxCandidates: slot.max_candidates,
          enrolledCount,
          isFull,
          isEnrolled,
        };
      });

    return Response.json(available);
  } catch (error) {
    return Response.json({ error: 'Failed to fetch available slots' }, { status: 500 });
  }
}
