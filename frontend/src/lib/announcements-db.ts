/**
 * announcements-db — accès Supabase partagés par les annonces générales.
 *
 * Extrait de `app/api/announcements/route.ts` : une route App Router ne doit
 * exporter que ses handlers, or la relance automatique des vœux
 * (`lib/wishes-reminder-db.ts`) a besoin du MÊME compteur de quota que
 * l'annonce manuelle — sinon les deux canaux se marcheraient dessus et le
 * plafond Resend (100 mails/jour) serait dépassé sans que personne ne voie
 * le dépassement.
 */

import { supabaseAdmin } from "@/lib/supabase";
import { startOfUtcDay } from "@/lib/announcements";

/**
 * La table n'existe pas encore côté Supabase (migration 13 non appliquée).
 *
 * Volontairement plus stricte que `isMissingTableError` (lib/supabase.ts),
 * qui accepte aussi « does not exist » / « schema cache » dans le message :
 * ces libellés apparaissent AUSSI quand c'est une colonne qui manque, et une
 * colonne absente ne doit pas être présentée comme « tables d'annonces
 * absentes » (le remède n'est pas la même migration).
 */
export function isMissingTable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "PGRST205";
}

export function migrationRequired() {
  return Response.json(
    {
      error:
        "Les tables d'annonces n'existent pas encore. Applique la section 13 " +
        "de MIGRATIONS_A_APPLIQUER.sql dans le SQL Editor de Supabase.",
    },
    { status: 503 },
  );
}

/**
 * Emails d'annonces déjà partis aujourd'hui (fenêtre UTC, comme Resend).
 *
 * Renvoie `null` si la table n'existe pas encore : l'aperçu doit rester
 * utilisable avant l'application de la migration (sinon l'admin n'a qu'un
 * compteur qui tourne dans le vide, sans savoir pourquoi).
 *
 * Compte aussi les relances automatiques de vœux : elles s'enregistrent
 * comme une annonce (`created_by_name: "Relance automatique"`) précisément
 * pour entrer dans ce total.
 */
export async function emailsSentToday(): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from("announcements")
    .select("email_sent")
    .gte("created_at", startOfUtcDay());
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return (data || []).reduce(
    (sum: number, row: { email_sent: number | null }) =>
      sum + (row.email_sent || 0),
    0,
  );
}
