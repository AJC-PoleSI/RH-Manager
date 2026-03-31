import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// POST /api/slots/bulk-create — Admin only
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload || !payload.isAdmin) return forbidden();

  try {
    const { epreuveId, date, startTime, endTime, rooms } = await req.json();

    if (!epreuveId || !date || !startTime || !endTime || !rooms || rooms.length === 0) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Fetch Epreuve configuration — use select('*') to avoid errors on missing columns
    const { data: epreuve, error: epreuveError } = await supabaseAdmin
      .from('epreuves')
      .select('*')
      .eq('id', epreuveId)
      .single();

    if (epreuveError || !epreuve) {
      return Response.json({ error: 'Epreuve not found' }, { status: 404 });
    }

    const duration = epreuve.duration_minutes || 30;
    const roulement = epreuve.roulement_minutes ?? 10;
    const minMembers = epreuve.min_evaluators_per_salle ?? 2;
    const tour = epreuve.tour || 1;

    let currentMin = timeToMinutes(startTime);
    const endMin = timeToMinutes(endTime);

    const slotsToInsert: any[] = [];
    const dateFormatted = new Date(date + 'T12:00:00').toISOString();

    while (currentMin + duration <= endMin) {
      const slotStart = minutesToTime(currentMin);
      
      // La découpe gère le reste s'il ne permet pas le plein roulement.
      // Mais l'épreuve MUST tenir entièrement.
      let slotEndMin = currentMin + duration;
      
      // Si on peut ajouter le roulement en entier sans dépasser la plage de fin, on le fait.
      if (slotEndMin + roulement <= endMin) {
          slotEndMin += roulement;
      } else {
          // Ajustement algorithmique sur le roulement.
          slotEndMin = endMin;
      }
      
      const slotEnd = minutesToTime(slotEndMin);
      
      for (const room of rooms) {
        slotsToInsert.push({
          date: dateFormatted,
          start_time: slotStart,
          end_time: slotEnd,
          duration_minutes: duration, // L'épreuve en elle-même est conservée pure pour l'affichage/logique candidates
          label: null,
          max_candidates: 1,
          min_members: minMembers,
          simultaneous_slots: 1,
          epreuve_id: epreuveId,
          tour: tour,
          room: `Salle ${room}`,
          status: 'draft', // Par sécurité : la phase 4 publiera l'ensemble.
        });
      }

      currentMin = slotEndMin;
    }

    if (slotsToInsert.length === 0) {
      return Response.json({ error: "La plage est trop courte pour accueillir ne serait-ce qu'une épreuve." }, { status: 400 });
    }

    const { data: createdSlots, error: insertError } = await supabaseAdmin
      .from('evaluation_slots')
      .insert(slotsToInsert)
      .select('*');

    if (insertError) throw insertError;

    return Response.json({ message: 'Success', count: createdSlots.length, slots: createdSlots }, { status: 201 });

  } catch (error) {
    console.error('Bulk generate error:', error);
    return Response.json({ error: 'Failed to generate bulk slots', details: String(error) }, { status: 500 });
  }
}
