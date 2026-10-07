import { supabaseAdmin } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/supabase-paging";

/**
 * Épreuves qui ont au moins un créneau PUBLIÉ (statut `published` ou `full`),
 * c.-à-d. ouvert à l'inscription des candidats. Sert à ne montrer la
 * description d'une épreuve aux candidats qu'une fois ses créneaux
 * disponibles (cf. candidateSeesDescription, lib/epreuve-candidate-view.ts).
 *
 * Paginé : la base dépasse 1000 créneaux et une lecture non paginée est
 * tronquée en silence. En cas d'erreur de lecture : ensemble vide — la
 * description reste masquée, ce qui est le choix prudent.
 */
export async function epreuvesWithPublishedSlots(): Promise<Set<string>> {
  const { data, error } = await fetchAllRows<{ epreuve_id: string }>(
    (from, to) =>
      supabaseAdmin
        .from("evaluation_slots")
        .select("epreuve_id")
        .in("status", ["published", "full"])
        .order("id")
        .range(from, to),
  );
  if (error || !data) {
    if (error) console.error("[published-slots] lecture impossible:", error);
    return new Set();
  }
  return new Set(data.map((r) => r.epreuve_id).filter(Boolean));
}
