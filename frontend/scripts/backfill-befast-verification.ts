/**
 * Rattrapage : candidats vérifiés côté RH mais restés « en attente » côté
 * Befast (comptes créés avant la propagation automatique du 13/09/2026, ou
 * propagation tombée en erreur depuis).
 *
 * Dry-run  : npx vite-node scripts/backfill-befast-verification.ts
 * Exécution: npx vite-node scripts/backfill-befast-verification.ts --apply
 *
 * Nécessite NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY /
 * INTEGRATION_SECRET / BEFAST_BASE_URL (frontend/.env.local).
 */
import { createClient } from "@supabase/supabase-js";
import { markVerifiedOnBefast } from "../src/lib/integration";

const APPLY = process.argv.includes("--apply");
const PAGE = 500;

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
    { auth: { persistSession: false } },
  );

  // Pagination explicite : Supabase plafonne toute lecture à 1000 lignes.
  const emails: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("candidates")
      .select("email")
      .eq("email_verified", true)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    emails.push(...data.map((c) => String(c.email)));
    if (data.length < PAGE) break;
  }

  console.log(`${emails.length} candidats vérifiés côté RH`);
  if (!APPLY) {
    console.log("DRY-RUN — relancer avec --apply pour propager à Befast.");
  }

  const tally: Record<string, number> = {};
  for (const email of emails) {
    if (!APPLY) continue;
    const res = await markVerifiedOnBefast(email);
    const key = res.ok ? (res.status ?? "ok") : (res.status ?? "error");
    tally[key] = (tally[key] ?? 0) + 1;
    if (key === "verified") console.log(`  ✔ ${email} → vérifié côté Befast`);
    if (!res.ok && key !== "unknown") console.error(`  ✖ ${email} → ${res.error}`);
  }

  if (APPLY) console.log("Bilan:", tally);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
