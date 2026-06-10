import { supabaseAdmin } from "@/lib/supabase";

/**
 * Un candidat est "admis au tour 2" quand sa délibération du tour 1 est
 * acceptée. C'est la condition de déblocage des choix de pôles.
 */
export async function isCandidateAdmittedTour1(
  candidateId: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("deliberations")
    .select("tour1_status")
    .eq("candidate_id", candidateId)
    .maybeSingle();

  return !error && data?.tour1_status === "accepted";
}

/**
 * Liste (dédupliquée) des pôles demandés par un candidat dans ses vœux.
 * Sert au filtrage des épreuves de pôle (Tour 3).
 */
export async function getCandidateWishedPoles(
  candidateId: string,
): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("candidate_wishes")
    .select("pole")
    .eq("candidate_id", candidateId);

  if (error || !data) return [];
  return Array.from(
    new Set(data.map((w: any) => w.pole).filter(Boolean)),
  ) as string[];
}
