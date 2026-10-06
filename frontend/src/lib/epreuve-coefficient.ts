import { supabaseAdmin } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/supabase-paging";
import { parseEpreuveCoefficient } from "@/lib/evaluation-criteria";
import { isMissingColumnError } from "@/lib/slot-lock";

/**
 * Coefficient choisi de chaque épreuve (onglet Réglages → Coefficients,
 * colonne `epreuves.coefficient`, 07/10/2026).
 *
 * Lu À PART plutôt qu'en ajoutant `coefficient` aux jointures
 * `epreuves(id, name, …)` des routes de notes : tant que la migration
 * supabase-migration-coefficient-epreuve.sql n'est pas appliquée, une requête
 * qui NOMME la colonne échoue en entier — délibération, fiche candidat et
 * export tomberaient tous en 500. Ici, colonne absente ⇒ table vide ⇒ toutes
 * les épreuves en automatique (barème ÷ 20), c'est-à-dire le calcul d'avant.
 *
 * Seules les épreuves dont le coefficient est valide (fini, > 0) figurent
 * dans la table ; `get(id) ?? null` donne donc directement la valeur à
 * transmettre aux calculs de moyenne.
 *
 * Toute AUTRE erreur remonte : mieux vaut un 500 qu'une moyenne calculée en
 * silence avec des poids faux.
 */
export async function fetchEpreuveCoefficients(): Promise<Map<string, number>> {
  const { data, error } = await fetchAllRows<any>((from, to) =>
    supabaseAdmin
      .from("epreuves")
      .select("id, coefficient")
      .order("id", { ascending: true })
      .range(from, to),
  );
  const map = new Map<string, number>();
  if (error) {
    if (isMissingColumnError(error)) return map;
    throw error;
  }
  for (const row of data || []) {
    const coef = parseEpreuveCoefficient(row.coefficient);
    if (coef !== null) map.set(row.id, coef);
  }
  return map;
}
