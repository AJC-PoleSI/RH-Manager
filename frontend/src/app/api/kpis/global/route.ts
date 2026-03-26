import { supabaseAdmin } from '@/lib/supabase';

// GET /api/kpis/global - Fetch global KPIs
export async function GET() {
  try {
    // Run count queries in parallel
    const [candidatesRes, evaluationsRes, epreuvesRes, membersRes, perMemberRes] =
      await Promise.all([
        supabaseAdmin.from('candidates').select('id', { count: 'exact', head: true }),
        supabaseAdmin.from('candidate_evaluations').select('id', { count: 'exact', head: true }),
        supabaseAdmin.from('epreuves').select('id', { count: 'exact', head: true }),
        supabaseAdmin.from('members').select('id', { count: 'exact', head: true }),
        supabaseAdmin.from('candidate_evaluations').select('memberId'),
      ]);

    // Count evaluations per member
    const evaluationsPerMember: Record<string, number> = {};
    if (perMemberRes.data) {
      for (const row of perMemberRes.data) {
        evaluationsPerMember[row.memberId] =
          (evaluationsPerMember[row.memberId] || 0) + 1;
      }
    }

    // Convert to sorted array (descending by count)
    const evaluationsPerMemberArray = Object.entries(evaluationsPerMember)
      .map(([memberId, count]) => ({ memberId, _count: { id: count } }))
      .sort((a, b) => b._count.id - a._count.id);

    return Response.json({
      totalCandidates: candidatesRes.count ?? 0,
      totalEvaluations: evaluationsRes.count ?? 0,
      totalEpreuves: epreuvesRes.count ?? 0,
      totalMembers: membersRes.count ?? 0,
      evaluationsPerMember: evaluationsPerMemberArray,
    });
  } catch (error) {
    console.error('KPI Error:', error);
    return Response.json({ error: 'Failed to fetch KPIs' }, { status: 500 });
  }
}
