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
