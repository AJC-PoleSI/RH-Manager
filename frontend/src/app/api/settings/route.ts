import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

// GET /api/settings — get all system settings as key-value map
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  try {
    const { data: settings, error } = await supabaseAdmin
      .from('system_settings')
      .select('*');

    if (error) throw error;

    const settingsMap = (settings || []).reduce(
      (acc: Record<string, string>, curr: { key: string; value: string }) => {
        acc[curr.key] = curr.value;
        return acc;
      },
      {} as Record<string, string>
    );

    const defaults: Record<string, string> = {
      dayStart: '8',
      dayEnd: '19',
      slotDuration: '60',
    };

    return Response.json({ ...defaults, ...settingsMap });
  } catch (error) {
    console.error(error);
    return Response.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

// PUT /api/settings — update settings (admin only)
export async function PUT(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const settings = await req.json();

    for (const [key, value] of Object.entries(settings)) {
      const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);

      const { error } = await supabaseAdmin
        .from('system_settings')
        .upsert(
          { key, value: stringValue },
          { onConflict: 'key' }
        );

      if (error) throw error;
    }

    return Response.json({ message: 'Settings updated' });
  } catch (error) {
    console.error(error);
    return Response.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
