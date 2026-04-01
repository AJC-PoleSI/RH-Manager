import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

// PUT /api/epreuves/[id] - Update an epreuve (admin only)
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  const { id } = params;

  try {
    const body = await req.json();
    const { name, tour, type, durationMinutes, roulementMinutes, nbSalles, minEvaluatorsPerSalle,
            evaluationQuestions, isPoleTest, pole,
            date, time, salle, presentedBy, dateDebut, dateFin, description, documentsUrls, isVisible } = body;

    // Build update object with only provided fields (snake_case for Supabase)
    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (tour !== undefined) updateData.tour = tour;
    if (type !== undefined) updateData.type = type;
    if (durationMinutes !== undefined) updateData.duration_minutes = durationMinutes;
    if (roulementMinutes !== undefined) updateData.roulement_minutes = roulementMinutes;
    if (nbSalles !== undefined) updateData.nb_salles = nbSalles;
    if (minEvaluatorsPerSalle !== undefined) updateData.min_evaluators_per_salle = minEvaluatorsPerSalle;
    if (isPoleTest !== undefined) updateData.is_pole_test = isPoleTest;
    if (pole !== undefined) updateData.pole = pole;
    if (evaluationQuestions !== undefined) {
      updateData.evaluation_questions =
        typeof evaluationQuestions === 'string'
          ? evaluationQuestions
          : JSON.stringify(evaluationQuestions);
    }
    // Champs date/logistique
    if (date !== undefined) updateData.date = date;
    if (time !== undefined) updateData.time = time;
    if (salle !== undefined) updateData.salle = salle;
    if (presentedBy !== undefined) updateData.presented_by = presentedBy;
    if (dateDebut !== undefined) updateData.date_debut = dateDebut;
    if (dateFin !== undefined) updateData.date_fin = dateFin;
    if (description !== undefined) updateData.description = description;
    if (documentsUrls !== undefined) updateData.documents_urls = documentsUrls;
    if (isVisible !== undefined) updateData.is_visible = isVisible;

    const { data: epreuve, error } = await supabaseAdmin
      .from('epreuves')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // ══════════════════════════════════════════════════════════════════
    // ÉPREUVE COMMUNE / SUR TABLE : Mettre à jour l'événement calendrier global
    // ══════════════════════════════════════════════════════════════════
    if (epreuve.type === 'commune' && epreuve.date) {
      const durationMin = epreuve.duration_minutes || 30;
      const startTime = epreuve.time || '09:00';
      const [h, m] = startTime.split(':').map(Number);
      const totalMin = h * 60 + (m || 0) + durationMin;
      const endTime = `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;

      // Chercher un événement existant pour cette épreuve
      const { data: existingEvent } = await supabaseAdmin
        .from('calendar_events')
        .select('id')
        .eq('related_epreuve_id', id)
        .limit(1);

      const eventData = {
        title: `${epreuve.name} (Sur table)`,
        description: `Épreuve commune — Tour ${epreuve.tour}${epreuve.salle ? ` — Salle : ${epreuve.salle}` : ''}${epreuve.presented_by ? ` — Présenté par : ${epreuve.presented_by}` : ''}`,
        day: new Date(epreuve.date + 'T12:00:00').toISOString(),
        start_time: startTime,
        end_time: endTime,
        related_epreuve_id: id,
        related_member_id: null,
        related_candidate_id: null,
        is_global: true,
      };

      if (existingEvent && existingEvent.length > 0) {
        await supabaseAdmin.from('calendar_events').update(eventData).eq('id', existingEvent[0].id);
      } else {
        await supabaseAdmin.from('calendar_events').insert(eventData);
      }
    }

    return Response.json(epreuve);
  } catch (error) {
    return Response.json({ error: 'Failed to update epreuve' }, { status: 400 });
  }
}

// DELETE /api/epreuves/[id] - Delete an epreuve (admin only)
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  const { id } = params;

  try {
    const { error } = await supabaseAdmin
      .from('epreuves')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json({ error: 'Failed to delete epreuve' }, { status: 400 });
  }
}
