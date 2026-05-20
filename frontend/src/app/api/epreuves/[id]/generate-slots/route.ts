import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

function timeToMin(t: string) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}
function minToTime(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// POST /api/epreuves/[id]/generate-slots
// Génère X salles × Y créneaux/jour pour les jours sélectionnés
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  const epreuveId = params.id;

  try {
    const {
      nombre_salles,
      salles_names,
      duree_creneau_minutes,
      heure_debut_journee,
      heure_fin_journee,
      quota_min_evaluateurs,
      days_selected,         // string[] "YYYY-MM-DD"
      delete_existing,       // boolean
    } = await req.json();

    if (!nombre_salles || !duree_creneau_minutes || !days_selected?.length) {
      return Response.json({ error: 'Paramètres manquants' }, { status: 400 });
    }

    const { data: epreuve, error: epErr } = await supabaseAdmin
      .from('epreuves').select('*').eq('id', epreuveId).single();
    if (epErr || !epreuve) return Response.json({ error: 'Épreuve introuvable' }, { status: 404 });

    // Optionnel : supprimer les créneaux draft existants
    if (delete_existing) {
      await supabaseAdmin.from('evaluation_slots')
        .delete().eq('epreuve_id', epreuveId).eq('status', 'draft');
    }

    const debutMin = timeToMin(heure_debut_journee || '08:00');
    const finMin   = timeToMin(heure_fin_journee   || '18:00');
    const duree    = Number(duree_creneau_minutes);
    const nSalles  = Number(nombre_salles);
    const quota    = Number(quota_min_evaluateurs) || epreuve.min_evaluators_per_salle || 2;

    const salles: string[] = Array.isArray(salles_names) && salles_names.length === nSalles
      ? salles_names
      : Array.from({ length: nSalles }, (_, i) => `Salle ${String.fromCharCode(65 + i)}`);

    const creneauxParSalle = Math.floor((finMin - debutMin) / duree);

    let ordre = 0;
    const toInsert: any[] = [];

    for (const day of days_selected as string[]) {
      const dateISO = new Date(day + 'T12:00:00').toISOString();
      for (let s = 0; s < nSalles; s++) {
        let cur = debutMin;
        for (let i = 0; i < creneauxParSalle; i++) {
          if (cur + duree > finMin) break;
          toInsert.push({
            epreuve_id: epreuveId,
            date: dateISO,
            start_time: minToTime(cur),
            end_time: minToTime(cur + duree),
            duration_minutes: duree,
            room: salles[s],
            label: `${salles[s]} — ${minToTime(cur)}`,
            max_candidates: epreuve.is_group_epreuve ? (epreuve.group_size || 1) : 1,
            min_members: quota,
            status: 'draft',
            tour: epreuve.tour || 1,
            ordre: ordre++,
          });
          cur += duree;
        }
      }
    }

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('evaluation_slots').insert(toInsert).select();
    if (insErr) throw insErr;

    // Mettre à jour workflow_status + config sur l'épreuve
    await supabaseAdmin.from('epreuves').update({
      workflow_status: 'creneaux_finalises',
      heure_debut_journee: heure_debut_journee || '08:00',
      heure_fin_journee:   heure_fin_journee   || '18:00',
      salles_names: JSON.stringify(salles),
    }).eq('id', epreuveId);

    const stats = {
      nombre_salles: nSalles,
      creneaux_par_salle_par_jour: creneauxParSalle,
      total_par_jour: creneauxParSalle * nSalles,
      nombre_jours: days_selected.length,
      total_creneaux: toInsert.length,
    };

    return Response.json({ success: true, creneaux_generated: inserted?.length, stats }, { status: 201 });
  } catch (e: any) {
    console.error('generate-slots error', e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
