import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

// POST /api/slots/reset — delete all slots for an epreuve (admin only)
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const { epreuveId, slotIds } = await req.json();

    if (!epreuveId && (!slotIds || slotIds.length === 0)) {
      return Response.json({ error: 'epreuveId ou slotIds requis' }, { status: 400 });
    }

    // Determine which slot IDs to delete
    let idsToDelete: string[] = slotIds || [];

    if (!idsToDelete.length && epreuveId) {
      const { data: slots } = await supabaseAdmin
        .from('evaluation_slots')
        .select('id')
        .eq('epreuve_id', epreuveId);
      idsToDelete = (slots || []).map((s: any) => s.id);
    }

    if (idsToDelete.length === 0) {
      return Response.json({ message: 'Aucun creneau a supprimer', deleted: 0 });
    }

    // 1. Delete enrollments (inscriptions candidats)
    const { error: enrollError } = await supabaseAdmin
      .from('slot_enrollments')
      .delete()
      .in('slot_id', idsToDelete);
    if (enrollError) console.error('Delete enrollments error:', enrollError);

    // 2. Delete member assignments
    const { error: assignError } = await supabaseAdmin
      .from('slot_member_assignments')
      .delete()
      .in('slot_id', idsToDelete);
    if (assignError) console.error('Delete assignments error:', assignError);

    // 3. Delete availability requests if table exists
    try {
      await supabaseAdmin
        .from('slot_availability_requests')
        .delete()
        .in('slot_id', idsToDelete);
    } catch {
      // Table may not exist
    }

    // 4. Delete the slots themselves
    const { error: slotError } = await supabaseAdmin
      .from('evaluation_slots')
      .delete()
      .in('id', idsToDelete);

    if (slotError) throw slotError;

    return Response.json({
      message: `${idsToDelete.length} creneau(x) supprime(s)`,
      deleted: idsToDelete.length,
    });
  } catch (error) {
    console.error('Reset slots error:', error);
    return Response.json(
      { error: 'Echec de la reinitialisation des creneaux', details: String(error) },
      { status: 500 }
    );
  }
}
