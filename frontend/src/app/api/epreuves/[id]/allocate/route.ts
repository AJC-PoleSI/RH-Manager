import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

// POST /api/epreuves/[id]/allocate
// Lance l'algorithme d'allocation intelligente
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  const epreuveId = params.id;

  try {
    const { data: epreuve } = await supabaseAdmin
      .from('epreuves').select('*').eq('id', epreuveId).single();
    if (!epreuve) return Response.json({ error: 'Épreuve introuvable' }, { status: 404 });

    const quotaZ = Number(epreuve.min_evaluators_per_salle) || 2;

    // Récupérer tous les créneaux de l'épreuve
    const { data: slots } = await supabaseAdmin
      .from('evaluation_slots').select('id, date, start_time, room')
      .eq('epreuve_id', epreuveId)
      .order('ordre', { ascending: true });

    // Récupérer toutes les candidatures (slot_availability_requests)
    const slotIds = (slots || []).map((s: any) => s.id);
    const { data: requests } = await supabaseAdmin
      .from('slot_availability_requests')
      .select('slot_id, member_id, member:members(id, email, first_name, last_name)')
      .in('slot_id', slotIds);

    const allRequests = requests || [];

    // ── ÉTAPE 1 : Compter les inscriptions par évaluateur ─────────────
    const inscriptionsParEval: Record<string, number> = {};
    allRequests.forEach((r: any) => {
      inscriptionsParEval[r.member_id] = (inscriptionsParEval[r.member_id] || 0) + 1;
    });

    const nEvalsActifs = Object.keys(inscriptionsParEval).length;
    const totalInscriptions = allRequests.length;
    const chargeTheorique = nEvalsActifs > 0 ? totalInscriptions / nEvalsActifs : 1;

    // ── ÉTAPE 2 : Calculer les scores de priorité ─────────────────────
    const scores: Record<string, number> = {};
    Object.entries(inscriptionsParEval).forEach(([evalId, count]) => {
      const ratio = count / chargeTheorique;
      scores[evalId] = ratio > 0 ? 1 / ratio : 0;
    });

    // ── ÉTAPE 3 : Effacer les allocations précédentes ─────────────────
    await supabaseAdmin.from('evaluator_allocations')
      .delete().eq('epreuve_id', epreuveId);

    // ── ÉTAPE 4 : Allocation par créneau ──────────────────────────────
    const allocationsToInsert: any[] = [];
    const creneauxNonRemplis: any[] = [];
    const allocationSnapshot: any = {};
    const EN_ATTENTE_COUNT = 3; // nombre de réservistes

    for (const slot of slots || []) {
      const inscrits = allRequests
        .filter((r: any) => r.slot_id === slot.id)
        .map((r: any) => ({
          member_id: r.member_id,
          member: r.member,
          score: scores[r.member_id] ?? 0,
        }))
        .sort((a, b) => b.score - a.score);

      const affectes   = inscrits.slice(0, quotaZ);
      const enAttente  = inscrits.slice(quotaZ, quotaZ + EN_ATTENTE_COUNT);

      const statut = affectes.length >= quotaZ ? 'OK' : 'NON_REMPLI';
      if (statut === 'NON_REMPLI') {
        creneauxNonRemplis.push({
          slot_id: slot.id,
          date: slot.date,
          heure_debut: slot.start_time,
          salle: slot.room,
          deficit: quotaZ - affectes.length,
        });
      }

      allocationSnapshot[slot.id] = { affectes, en_attente: enAttente, statut };

      affectes.forEach((a, idx) => {
        allocationsToInsert.push({
          epreuve_id: epreuveId,
          member_id: a.member_id,
          slot_id: slot.id,
          rang_priorite: idx + 1,
          score_priorite: a.score,
          statut: 'affecte',
          modifie_par_admin: false,
        });
      });
      enAttente.forEach((a, idx) => {
        allocationsToInsert.push({
          epreuve_id: epreuveId,
          member_id: a.member_id,
          slot_id: slot.id,
          rang_priorite: quotaZ + idx + 1,
          score_priorite: a.score,
          statut: 'en_attente',
          modifie_par_admin: false,
        });
      });
    }

    if (allocationsToInsert.length > 0) {
      const { error: allocErr } = await supabaseAdmin
        .from('evaluator_allocations').insert(allocationsToInsert);
      if (allocErr) throw allocErr;
    }

    // ── ÉTAPE 5 : Mettre à jour slot_member_assignments ──────────────
    // Sync les affectés → slot_member_assignments (pour compatibilité existing code)
    await supabaseAdmin.from('slot_member_assignments')
      .delete().in('slot_id', slotIds);

    const assignmentsToInsert = allocationsToInsert
      .filter(a => a.statut === 'affecte')
      .map(a => ({ slot_id: a.slot_id, member_id: a.member_id }));

    if (assignmentsToInsert.length > 0) {
      await supabaseAdmin.from('slot_member_assignments').insert(assignmentsToInsert);
    }

    // ── ÉTAPE 6 : Historique ──────────────────────────────────────────
    const { data: lastHist } = await supabaseAdmin
      .from('allocation_history').select('version')
      .eq('epreuve_id', epreuveId).order('version', { ascending: false }).limit(1);

    const nextVersion = ((lastHist?.[0]?.version) || 0) + 1;
    await supabaseAdmin.from('allocation_history').insert({
      epreuve_id: epreuveId,
      version: nextVersion,
      allocations: allocationSnapshot,
      statistiques: {
        total_creneaux: slots?.length || 0,
        creneaux_complets: (slots?.length || 0) - creneauxNonRemplis.length,
        creneaux_non_remplis: creneauxNonRemplis.length,
        quota_z: quotaZ,
        total_evaluateurs_actifs: nEvalsActifs,
        charge_theorique: chargeTheorique,
      },
      triggered_by: 'allocation_auto',
    });

    // ── ÉTAPE 7 : Workflow → allocated ────────────────────────────────
    await supabaseAdmin.from('epreuves')
      .update({ workflow_status: 'allocated' }).eq('id', epreuveId);

    return Response.json({
      success: creneauxNonRemplis.length === 0,
      creneaux_non_remplis: creneauxNonRemplis,
      statistiques: {
        total_creneaux: slots?.length || 0,
        creneaux_complets: (slots?.length || 0) - creneauxNonRemplis.length,
        creneaux_non_remplis: creneauxNonRemplis.length,
        total_evaluateurs_actifs: nEvalsActifs,
        quota_z: quotaZ,
      },
    });
  } catch (e: any) {
    console.error('allocate error', e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
