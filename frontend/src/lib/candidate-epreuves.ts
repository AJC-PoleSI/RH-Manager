import { supabaseAdmin } from "@/lib/supabase";
import { enrolledEpreuveIds } from "@/lib/epreuve-candidate-view";

/**
 * Épreuves auxquelles CE candidat est inscrit : créneau à inscription active,
 * ou inscription en distanciel. Sert à ne montrer la description (l'énoncé)
 * d'une épreuve qu'aux inscrits (cf. candidateSeesDescription,
 * lib/epreuve-candidate-view.ts).
 *
 * Pas de pagination : un candidat n'a que quelques inscriptions. En cas
 * d'erreur de lecture : on ignore la source en échec — la description reste
 * masquée, ce qui est le choix prudent. Table des inscriptions en distanciel
 * absente = aucune.
 */
export async function candidateEnrolledEpreuves(candidateId: string): Promise<Set<string>> {
  const [enrollRes, regRes] = await Promise.all([
    supabaseAdmin
      .from("slot_enrollments")
      .select("status, slot:evaluation_slots(epreuve_id)")
      .eq("candidate_id", candidateId),
    supabaseAdmin
      .from("epreuve_registrations")
      .select("epreuve_id")
      .eq("candidate_id", candidateId),
  ]);
  if (enrollRes.error) {
    console.error("[candidate-epreuves] inscriptions illisibles:", enrollRes.error);
  }
  return enrolledEpreuveIds(
    (enrollRes.data || []).map((e: any) => ({
      status: e.status,
      epreuveId: e.slot?.epreuve_id ?? null,
    })),
    (regRes.data || []).map((r: any) => ({ epreuveId: r.epreuve_id })),
  );
}
