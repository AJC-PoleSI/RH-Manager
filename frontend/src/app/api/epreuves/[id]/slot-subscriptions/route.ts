import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized } from '@/lib/auth';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

// GET /api/epreuves/[id]/slot-subscriptions
// Admin: tous les créneaux + qui est inscrit
// Member: ses propres inscriptions
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();

  try {
    const { data: slots, error } = await supabaseAdmin
      .from('evaluation_slots')
      .select(`
        id, date, start_time, end_time, room, status, ordre,
        requests:slot_availability_requests(
          id, member_id,
          member:members(id, email, first_name, last_name)
        )
      `)
      .eq('epreuve_id', params.id)
      .order('ordre', { ascending: true });

    if (error) throw error;

    if (user.isAdmin) {
      return Response.json(slots || []);
    }

    // Pour un évaluateur : retourner ses inscriptions uniquement
    const mySubscriptions = (slots || [])
      .filter((s: any) => s.requests?.some((r: any) => r.member_id === user.id))
      .map((s: any) => ({ ...s, is_subscribed: true }));

    return Response.json(mySubscriptions);
  } catch (e: any) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
