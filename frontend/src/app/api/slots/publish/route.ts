import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

// POST /api/slots/publish — publish generated slots to DB (admin)
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const { epreuveId, slots } = await req.json();

    if (!epreuveId || !slots || !Array.isArray(slots)) {
      return Response.json(
        { error: 'epreuveId and slots array required' },
        { status: 400 }
      );
    }

    // Verify epreuve exists
    const { data: epreuve, error: epreuveError } = await supabaseAdmin
      .from('epreuves')
      .select('*')
      .eq('id', epreuveId)
      .single();

    if (epreuveError || !epreuve) {
      return Response.json({ error: 'Epreuve not found' }, { status: 404 });
    }

    const createdSlots = [];

    for (const slot of slots) {
      for (const room of slot.rooms) {
        // Create the slot
        const { data: created, error: createError } = await supabaseAdmin
          .from('evaluation_slots')
          .insert({
            epreuve_id: epreuveId,
            date: new Date(slot.date + 'T12:00:00').toISOString(),
            start_time: slot.startTime,
            end_time: slot.endTime,
            room: room.roomLabel || `Salle ${room.roomNumber}`,
            max_candidates: room.maxCandidates || 1,
            min_members: 1,
            status: 'open',
            tour: epreuve.tour,
          })
          .select()
          .single();

        if (createError) throw createError;

        // Assign members
        if (room.members && room.members.length > 0) {
          const memberRows = room.members.map((m: any) => ({
            slot_id: created.id,
            member_id: m.id,
          }));

          const { error: memberError } = await supabaseAdmin
            .from('slot_member_assignments')
            .insert(memberRows);

          if (memberError) throw memberError;
        }

        // Re-fetch with members for response
        const { data: fullSlot } = await supabaseAdmin
          .from('evaluation_slots')
          .select(`
            *,
            members:slot_member_assignments(*, member:members(email))
          `)
          .eq('id', created.id)
          .single();

        createdSlots.push(fullSlot);
      }
    }

    return Response.json({
      success: true,
      count: createdSlots.length,
      slots: createdSlots,
    });
  } catch (error) {
    console.error('Publish slots error:', error);
    return Response.json(
      { error: 'Failed to publish slots', details: String(error) },
      { status: 500 }
    );
  }
}
