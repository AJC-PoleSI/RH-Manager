import { supabaseAdmin } from "@/lib/supabase";

// Helpers d'autorisation partagés entre les routes d'évaluation collaborative
// (commentaires de groupe, évaluations des pairs, cochage "qui examine qui").

export interface CandidateSlot {
  slotId: string;
  epreuveId: string;
}

/**
 * Trouve le créneau (slot) de l'épreuve donnée où le candidat a une
 * inscription active. Retourne null si aucune inscription active.
 */
export async function resolveCandidateSlot(
  candidateId: string,
  epreuveId: string,
): Promise<CandidateSlot | null> {
  const { data, error } = await supabaseAdmin
    .from("slot_enrollments")
    .select("status, slot:evaluation_slots!inner(id, epreuve_id)")
    .eq("candidate_id", candidateId);

  if (error || !data) return null;

  for (const row of data as any[]) {
    if (row.status && row.status !== "active") continue;
    const slot = row.slot;
    if (slot && slot.epreuve_id === epreuveId) {
      return { slotId: slot.id, epreuveId };
    }
  }
  return null;
}

/**
 * Vérifie qu'un membre est assigné comme examinateur à un créneau donné.
 */
export async function isMemberAssignedToSlot(
  memberId: string,
  slotId: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("slot_member_assignments")
    .select("id")
    .eq("member_id", memberId)
    .eq("slot_id", slotId)
    .limit(1);

  return !error && !!data && data.length > 0;
}
