import { supabaseAdmin, isMissingTableError } from "@/lib/supabase";
import type { SlotLink } from "@/lib/slot-links";

/**
 * slot-links-db — Lecture des liens de business game (côté serveur).
 *
 * Séparé de `slot-links.ts`, qui est importé par des composants client :
 * le client Supabase n'a rien à faire dans le bundle navigateur.
 */

/** Ligne telle qu'elle sort de la base. */
interface SlotLinkRow {
  slot_id: string;
  url: string;
  label: string | null;
  updated_at: string | null;
}

/**
 * Par paquets de 200 identifiants : un `.in()` se traduit par une liste dans
 * l'URL de la requête, et 1000 UUID la feraient dépasser la limite de taille
 * de PostgREST. Chaque paquet reste aussi loin du plafond de 1000 lignes qui
 * tronque silencieusement les lectures (cf. lib/supabase-paging.ts).
 */
const ID_CHUNK = 200;

/**
 * Liens des créneaux demandés, indexés par `slot_id`.
 *
 * L'APPELANT GARANTIT LE PÉRIMÈTRE : cette fonction ne sait pas qui demande.
 * Elle n'est à utiliser que sur des identifiants de créneaux issus des
 * affectations du demandeur (`slot_member_assignments.member_id = <lui>`),
 * comme le font /api/slots/my-slots et /api/evaluations/next-candidates.
 *
 * FAIL-SOFT ASSUMÉ : les migrations de ce projet s'appliquent à la main. Entre
 * le déploiement et l'exécution du SQL, `slot_links` n'existe pas. Un planning
 * d'examinateur qui renverrait 500 pour un lien absent serait une régression
 * bien plus grave que l'absence du lien : on renvoie une map vide.
 */
export async function fetchSlotLinks(
  slotIds: string[],
): Promise<Map<string, SlotLink>> {
  const ids = Array.from(new Set(slotIds.filter(Boolean)));
  const links = new Map<string, SlotLink>();
  if (ids.length === 0) return links;

  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const { data, error } = await supabaseAdmin
      .from("slot_links")
      .select("slot_id, url, label, updated_at")
      .in("slot_id", chunk);

    if (error) {
      if (!isMissingTableError(error)) {
        console.error("fetchSlotLinks error:", error);
      }
      return links;
    }

    for (const row of (data || []) as SlotLinkRow[]) {
      links.set(row.slot_id, {
        url: row.url,
        label: row.label ?? null,
        updatedAt: row.updated_at ?? null,
      });
    }
  }

  return links;
}
