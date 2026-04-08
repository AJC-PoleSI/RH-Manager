import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/kpis/global - Fetch global KPIs with real data
export async function GET() {
  try {
    // Run all count queries in parallel
    const [
      candidatesRes,
      evaluationsRes,
      epreuvesRes,
      membersRes,
      perMemberRes,
      slotsRes,
      deliberationsRes,
      epreuvesDataRes,
      availabilitiesCountRes,
    ] = await Promise.all([
      supabaseAdmin.from('candidates').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('candidate_evaluations').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('epreuves').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('members').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('candidate_evaluations').select('member_id'),
      supabaseAdmin.from('evaluation_slots').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('deliberations').select('*'),
      supabaseAdmin.from('epreuves').select('tour'),
      supabaseAdmin.from('availabilities').select('id', { count: 'exact', head: true }),
    ]);

    // Count evaluations per member
    const evaluationsPerMember: Record<string, number> = {};
    if (perMemberRes.data) {
      for (const row of perMemberRes.data) {
        evaluationsPerMember[row.member_id] =
          (evaluationsPerMember[row.member_id] || 0) + 1;
      }
    }

    const evaluationsPerMemberArray = Object.entries(evaluationsPerMember)
      .map(([memberId, count]) => ({ memberId, _count: { id: count } }))
      .sort((a, b) => b._count.id - a._count.id);

    // Compute unique tours created
    const toursSet = new Set<number>();
    if (epreuvesDataRes.data) {
      epreuvesDataRes.data.forEach((ep: any) => {
        if (ep.tour) toursSet.add(ep.tour);
      });
    }
    const toursCreated = toursSet.size;

    // Compute candidate statuses from deliberations
    const totalCandidates = candidatesRes.count ?? 0;
    const deliberations = deliberationsRes.data || [];

    // A candidate is "accepted" if their latest deliberation tour status is 'accepted'
    // A candidate is "refused" if any tour status is 'refused'
    // A candidate is "waiting" if any tour status is 'waiting'
    // Otherwise "pending" (en cours)
    let accepted = 0;
    let refused = 0;
    let waiting = 0;

    deliberations.forEach((d: any) => {
      // Check from the highest tour to find the latest decision
      const statuses = [d.tour3_status, d.tour2_status, d.tour1_status];
      let found = false;
      for (const s of statuses) {
        if (s && s !== 'pending') {
          if (s === 'accepted') accepted++;
          else if (s === 'refused') refused++;
          else if (s === 'waiting') waiting++;
          found = true;
          break;
        }
      }
      // If all pending, the candidate is still "en cours"
    });

    const enCours = totalCandidates - accepted - refused - waiting;

    // Compute evaluation completion rate
    // How many candidates have at least one evaluation?
    const candidatesWithEvals = Object.keys(
      (perMemberRes.data || []).reduce((acc: Record<string, boolean>, row: any) => {
        // We actually need candidate_id, not member_id for this
        return acc;
      }, {})
    ).length;

    return Response.json({
      totalCandidates,
      totalEvaluations: evaluationsRes.count ?? 0,
      totalEpreuves: epreuvesRes.count ?? 0,
      totalMembers: membersRes.count ?? 0,
      totalSlots: slotsRes.count ?? 0,
      totalAvailabilities: availabilitiesCountRes.count ?? 0,
      toursCreated,
      evaluationsPerMember: evaluationsPerMemberArray,
      // Candidate progression
      enCours: Math.max(enCours, 0),
      accepted,
      refused,
      waiting,
    });
  } catch (error) {
    console.error('KPI Error:', error);
    return Response.json({ error: 'Failed to fetch KPIs' }, { status: 500 });
  }
}
