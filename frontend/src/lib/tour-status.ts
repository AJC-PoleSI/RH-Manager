import { supabaseAdmin } from "@/lib/supabase";

// Statuts possibles d'un tour dans la table `tours` :
//   - "a_venir"  : pas encore commencé
//   - "en_cours" : tour actif (décisions modifiables, candidats peuvent agir)
//   - "termine"  : tour verrouillé (décisions figées)
export type TourStatus = "a_venir" | "en_cours" | "termine";

export function extractTourNumber(name: string): number {
  const m = name.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

interface TourRow {
  id: string;
  name: string;
  status: string;
}

/**
 * Renvoie la liste des tours indexée par numéro (1, 2, 3…), avec leur id et
 * leur statut. Sert à savoir si un tour est verrouillé et à faire avancer le
 * recrutement d'un tour au suivant.
 */
export async function getToursByNumber(): Promise<Record<number, TourRow>> {
  const { data, error } = await supabaseAdmin
    .from("tours")
    .select("id, name, status");

  if (error || !data) return {};

  const map: Record<number, TourRow> = {};
  data.forEach((t: TourRow) => {
    const n = extractTourNumber(t.name);
    // En cas de doublon de numéro, on garde le premier rencontré.
    if (n && !map[n]) map[n] = t;
  });
  return map;
}

/**
 * Un tour est "verrouillé" lorsque son statut est "termine". Dans ce cas les
 * décisions de délibération (admis / refusé / réserve) ne sont plus
 * modifiables tant que le tour n'a pas été réouvert.
 */
export async function isTourLocked(tourNumber: number): Promise<boolean> {
  const map = await getToursByNumber();
  return map[tourNumber]?.status === "termine";
}
