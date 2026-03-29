import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

// GET /api/kpis/poles — KPI des voeux de pôles pour la Soirée Débat
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  try {
    // Fetch all wishes
    const { data: wishes, error: wishError } = await supabaseAdmin
      .from('candidate_wishes')
      .select('*, candidate:candidates(id, first_name, last_name)');

    if (wishError) throw wishError;

    // Fetch accepted deliberations (pour compter les places acceptées)
    const { data: deliberations, error: delibError } = await supabaseAdmin
      .from('deliberations')
      .select('candidate_id, tour1_status, tour2_status, tour3_status, assigned_pole');

    if (delibError) throw delibError;

    // Agréger par pôle
    const poleStats: Record<string, {
      pole: string;
      totalDemandes: number;       // Nombre total de voeux pour ce pôle (tous rangs)
      demandesRang1: number;       // Voeux en rang 1 (premier choix)
      demandesRang2: number;       // Voeux en rang 2
      demandesRang3: number;       // Voeux en rang 3
      placesAcceptees: number;     // Candidats assignés à ce pôle (acceptés)
    }> = {};

    // Compter les demandes par pôle et rang
    (wishes || []).forEach((w: any) => {
      const pole = w.pole || 'Non défini';
      if (!poleStats[pole]) {
        poleStats[pole] = {
          pole,
          totalDemandes: 0,
          demandesRang1: 0,
          demandesRang2: 0,
          demandesRang3: 0,
          placesAcceptees: 0,
        };
      }
      poleStats[pole].totalDemandes++;
      if (w.rank === 1) poleStats[pole].demandesRang1++;
      else if (w.rank === 2) poleStats[pole].demandesRang2++;
      else if (w.rank === 3) poleStats[pole].demandesRang3++;
    });

    // Compter les places acceptées par pôle
    (deliberations || []).forEach((d: any) => {
      if (d.assigned_pole && poleStats[d.assigned_pole]) {
        poleStats[d.assigned_pole].placesAcceptees++;
      }
    });

    // Trier par nombre total de demandes (desc)
    const result = Object.values(poleStats).sort((a, b) => b.totalDemandes - a.totalDemandes);

    return Response.json({
      poles: result,
      totalWishes: (wishes || []).length,
      totalCandidatesWithWishes: new Set((wishes || []).map((w: any) => w.candidate_id)).size,
    });
  } catch (error) {
    console.error('KPI poles error:', error);
    return Response.json({ error: 'Failed to fetch pole KPIs' }, { status: 500 });
  }
}
