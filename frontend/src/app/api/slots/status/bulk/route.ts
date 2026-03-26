import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

// PUT /api/slots/status/bulk — bulk update slot status (admin)
export async function PUT(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const { slotIds, status } = await req.json();

    if (!slotIds || !status) {
      return Response.json(
        { error: 'slotIds and status required' },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from('evaluation_slots')
      .update({ status })
      .in('id', slotIds);

    if (error) throw error;

    return Response.json({ success: true, updated: slotIds.length });
  } catch (error) {
    return Response.json({ error: 'Failed to update slot status' }, { status: 500 });
  }
}
