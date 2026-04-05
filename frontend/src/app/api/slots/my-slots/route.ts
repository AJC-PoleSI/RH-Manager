import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized } from '@/lib/auth';
import { NextRequest } from 'next/server';
export const dynamic = 'force-dynamic';

// GET /api/slots/my-slots — member's assigned slots
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const memberId = payload.id;

  try {
    const { data: assignments, error } = await supabaseAdmin
      .from('slot_member_assignments')
      .select(`
        *,
        slot:evaluation_slots(
          *,
          epreuve:epreuves(name, tour, type),
          enrollments:slot_enrollments(*, candidate:candidates(id, first_name, last_name)),
          members:slot_member_assignments(*, member:members(email))
        )
      `)
      .eq('member_id', memberId);

    if (error) throw error;

    const slots = (assignments || [])
      .filter((a: any) => a.slot && a.slot.epreuve && ['published', 'closed'].includes(a.slot.status))
      .map((a: any) => ({
        ...a.slot,
        myAssignment: true,
      }))
      .sort((a: any, b: any) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return dateA - dateB || (a.start_time || '').localeCompare(b.start_time || '');
      });

    return Response.json(slots);
  } catch (error) {
    return Response.json({ error: 'Failed to fetch my slots' }, { status: 500 });
  }
}
