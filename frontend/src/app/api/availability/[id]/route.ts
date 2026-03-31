import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized } from '@/lib/auth';
import { NextRequest } from 'next/server';

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const payload = getTokenFromRequest(req);
  if (!payload || !payload.isAdmin) return unauthorized();

  const id = params.id;
  if (!id) return Response.json({ error: 'ID manquant' }, { status: 400 });

  try {
    const { error } = await supabaseAdmin
      .from('availabilities')
      .delete()
      .eq('id', id);

    if (error) throw error;
    
    return Response.json({ success: true });
  } catch (error) {
    console.error('Erreur suppression dispo:', error);
    return Response.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
