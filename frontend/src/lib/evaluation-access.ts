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

/**
 * Liste les épreuves qu'un membre est autorisé à évaluer POUR UN CANDIDAT
 * donné : celles où il est assigné à un créneau sur lequel ce candidat a une
 * inscription active. C'est la règle unique qui gouverne l'accès aux
 * évaluations (individuelles, collectives, commentaires, cochage).
 *
 * Les admins ne passent pas par ici : ils voient tout.
 */
export async function listEvaluableEpreuveIds(
  memberId: string,
  candidateId: string,
): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("slot_member_assignments")
    .select(
      "slot:evaluation_slots!inner(id, epreuve_id, enrollments:slot_enrollments(candidate_id, status))",
    )
    .eq("member_id", memberId);

  if (error || !data) return [];

  const ids = new Set<string>();
  for (const row of data as any[]) {
    const slot = row.slot;
    if (!slot?.epreuve_id) continue;
    const hasCandidate = (slot.enrollments || [])
      .filter((e: any) => !e.status || e.status === "active")
      .some((e: any) => e.candidate_id === candidateId);
    if (hasCandidate) ids.add(slot.epreuve_id);
  }
  return Array.from(ids);
}

/**
 * Un membre peut-il évaluer ce candidat sur cette épreuve ?
 * `isAdmin` court-circuite la vérification.
 */
export async function canEvaluate(
  memberId: string,
  candidateId: string,
  epreuveId: string,
  isAdmin = false,
): Promise<boolean> {
  if (isAdmin) return true;
  const ids = await listEvaluableEpreuveIds(memberId, candidateId);
  return ids.includes(epreuveId);
}
