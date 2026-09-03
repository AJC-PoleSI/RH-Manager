import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabaseAdmin: SupabaseClient | null = null;
let _supabase: SupabaseClient | null = null;

function getSupabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
}

// Server-side client with service role (for API routes - bypasses RLS)
export function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    const url = getSupabaseUrl();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!url || !key) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }
    _supabaseAdmin = createClient(url, key);
  }
  return _supabaseAdmin;
}

// Client-side client (for direct browser use if needed)
export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = getSupabaseUrl();
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
    if (!url || !key) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
    }
    _supabase = createClient(url, key);
  }
  return _supabase;
}

// Legacy exports for compatibility - lazy getter
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return (getSupabaseAdmin() as any)[prop];
  },
});

export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return (getSupabase() as any)[prop];
  },
});

export default supabaseAdmin;

/**
 * La table n'existe pas encore en base.
 *
 * Les migrations de ce projet sont appliquées À LA MAIN dans le SQL Editor de
 * Supabase (cf. MIGRATIONS_A_APPLIQUER.sql) : entre un déploiement et
 * l'exécution du SQL, le code tourne face à un schéma incomplet. Plutôt
 * qu'une 500 opaque, les routes concernées dégradent proprement et disent au
 * staff que la migration reste à poser.
 *
 * PostgREST remonte tantôt le code Postgres `42P01`, tantôt son propre
 * `PGRST205` (table absente du cache de schéma).
 */
export function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as any).code ?? "");
  if (code === "42P01" || code === "PGRST205") return true;
  const message = String((error as any).message ?? "").toLowerCase();
  return (
    message.includes("does not exist") || message.includes("schema cache")
  );
}
