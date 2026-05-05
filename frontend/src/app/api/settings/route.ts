import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

// In-memory cache: avoid hammering Supabase on every page navigation
let settingsCache: Record<string, string> | null = null;
let settingsCacheAt = 0;
const SETTINGS_TTL_MS = 5 * 60 * 1000; // 5 minutes

function invalidateSettingsCache() {
  settingsCache = null;
  settingsCacheAt = 0;
}

const DEFAULTS: Record<string, string> = {
  dayStart: '8',
  dayEnd: '19',
  slotDuration: '60',
};

// GET /api/settings — get all system settings as key-value map
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  try {
    const now = Date.now();
    if (!settingsCache || now - settingsCacheAt > SETTINGS_TTL_MS) {
      const { data: settings, error } = await supabaseAdmin
        .from('system_settings')
        .select('*');
      if (error) throw error;
      settingsCache = (settings || []).reduce(
        (acc: Record<string, string>, curr: { key: string; value: string }) => {
          acc[curr.key] = curr.value;
          return acc;
        },
        {} as Record<string, string>
      );
      settingsCacheAt = now;
    }

    return Response.json({ ...DEFAULTS, ...settingsCache });
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

    invalidateSettingsCache(); // force fresh read on next GET
    return Response.json({ message: 'Settings updated' });
  } catch (error) {
    console.error(error);
    return Response.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
