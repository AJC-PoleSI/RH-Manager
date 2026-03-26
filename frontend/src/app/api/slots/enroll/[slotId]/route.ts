import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized } from '@/lib/auth';
import { NextRequest } from 'next/server';

// DELETE /api/slots/enroll/[slotId] — cancel enrollment
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slotId: string }> }
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  if (payload.role !== 'candidate') {
    return Response.json({ error: 'Candidate auth required' }, { status: 401 });
  }

  const { slotId } = await params;
  const candidateId = payload.id;

  try {
    // Find enrollment
    const { data: enrollments, error: findError } = await supabaseAdmin
      .from('slot_enrollments')
      .select('id')
      .eq('slot_id', slotId)
      .eq('candidate_id', candidateId)
      .limit(1);

    if (findError) throw findError;

    if (!enrollments || enrollments.length === 0) {
      return Response.json({ error: 'Inscription non trouvée' }, { status: 404 });
    }

    // Delete enrollment
    const { error: deleteError } = await supabaseAdmin
      .from('slot_enrollments')
      .delete()
      .eq('id', enrollments[0].id);

    if (deleteError) throw deleteError;

    // If slot was full, reopen it
    const { data: slot } = await supabaseAdmin
      .from('evaluation_slots')
      .select('*, enrollments:slot_enrollments(id), members:slot_member_assignments(id)')
      .eq('id', slotId)
      .single();

    if (slot && slot.status === 'full') {
      const newStatus =
        (slot.members?.length || 0) >= slot.min_members ? 'ready' : 'open';
      await supabaseAdmin
        .from('evaluation_slots')
        .update({ status: newStatus })
        .eq('id', slotId);
    }

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: 'Failed to cancel enrollment' }, { status: 500 });
  }
}
