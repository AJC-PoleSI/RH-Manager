import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized } from '@/lib/auth';
import { NextRequest } from 'next/server';

// POST /api/slots/enroll — candidate enrolls in a slot
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const candidateId = payload.id;
  if (payload.role !== 'candidate') {
    return Response.json({ error: 'Candidate auth required' }, { status: 401 });
  }

  try {
    const { slotId } = await req.json();
    if (!slotId) {
      return Response.json({ error: 'slotId required' }, { status: 400 });
    }

    // Fetch slot with enrollments and members
    const { data: slot, error: slotError } = await supabaseAdmin
      .from('evaluation_slots')
      .select(`
        *,
        enrollments:slot_enrollments(*),
        members:slot_member_assignments(id),
        epreuve:epreuves(*)
      `)
      .eq('id', slotId)
      .single();

    if (slotError || !slot) {
      return Response.json({ error: 'Slot not found' }, { status: 404 });
    }

    if (!['published', 'ready'].includes(slot.status)) {
      return Response.json({ error: "Ce créneau n'est plus disponible" }, { status: 400 });
    }

    // Check min members met
    if ((slot.members?.length || 0) < slot.min_members) {
      return Response.json(
        { error: "Pas assez d'évaluateurs sur ce créneau" },
        { status: 400 }
      );
    }

    if ((slot.enrollments?.length || 0) >= slot.max_candidates) {
      return Response.json({ error: 'Ce créneau est complet' }, { status: 400 });
    }

    // Check if already enrolled in this slot
    const alreadyEnrolled = slot.enrollments?.some(
      (e: any) => e.candidate_id === candidateId
    );
    if (alreadyEnrolled) {
      return Response.json(
        { error: 'Vous êtes déjà inscrit à ce créneau' },
        { status: 400 }
      );
    }

    // Check if candidate already enrolled in another slot for the same epreuve
    if (slot.epreuve_id) {
      const { data: otherEnrollment } = await supabaseAdmin
        .from('slot_enrollments')
        .select('id, slot:evaluation_slots!inner(epreuve_id)')
        .eq('candidate_id', candidateId)
        .eq('slot.epreuve_id', slot.epreuve_id)
        .neq('status', 'cancelled')
        .limit(1);

      if (otherEnrollment && otherEnrollment.length > 0) {
        return Response.json(
          { error: 'Vous êtes déjà inscrit à un autre créneau pour cette épreuve' },
          { status: 400 }
        );
      }
    }

    // Create enrollment
    const { data: enrollment, error: enrollError } = await supabaseAdmin
      .from('slot_enrollments')
      .insert({ slot_id: slotId, candidate_id: candidateId })
      .select(`
        *,
        slot:evaluation_slots(*, epreuve:epreuves(name))
      `)
      .single();

    if (enrollError) throw enrollError;

    // Auto-update status if full
    const { data: updatedSlot } = await supabaseAdmin
      .from('evaluation_slots')
      .select('*, enrollments:slot_enrollments(id)')
      .eq('id', slotId)
      .single();

    if (
      updatedSlot &&
      (updatedSlot.enrollments?.length || 0) >= updatedSlot.max_candidates
    ) {
      await supabaseAdmin
        .from('evaluation_slots')
        .update({ status: 'full' })
        .eq('id', slotId);
    }

    return Response.json(enrollment, { status: 201 });
  } catch (error: any) {
    // Unique constraint violation
    if (error?.code === '23505') {
      return Response.json({ error: 'Déjà inscrit' }, { status: 400 });
    }
    console.error('Enroll error:', error);
    return Response.json(
      { error: 'Failed to enroll', details: String(error) },
      { status: 500 }
    );
  }
}
