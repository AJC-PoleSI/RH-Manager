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
 * inscription active (entretiens, épreuves de groupe).
 *
 * Les épreuves sur table (type `commune`) n'ont NI créneau NI inscription
 * (convocation globale) et ne sont donc jamais retournées ici : seul un
 * admin peut les noter (`canEvaluate` court-circuite pour lui).
 *
 * C'est la règle unique qui gouverne l'accès aux évaluations (individuelles,
 * collectives, commentaires, cochage).
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

  const ids = new Set<string>();

  if (!error && data) {
    for (const row of data as any[]) {
      const slot = row.slot;
      if (!slot?.epreuve_id) continue;
      const hasCandidate = (slot.enrollments || [])
        .filter((e: any) => !e.status || e.status === "active")
        .some((e: any) => e.candidate_id === candidateId);
      if (hasCandidate) ids.add(slot.epreuve_id);
    }
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

/**
 * Liste les membres assignés à un créneau (ids). Sert à déterminer si une
 * épreuve individuelle est passée en binôme (2+ examinateurs sur le même
 * créneau) et à qui attribuer l'évaluation partagée qui en résulte.
 */
export async function getSlotExaminerIds(slotId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("slot_member_assignments")
    .select("member_id")
    .eq("slot_id", slotId);

  if (error || !data) return [];
  return data.map((r: any) => r.member_id).filter(Boolean);
}

/**
 * Vrai si l'erreur signifie « colonne absente » (migration pas encore
 * appliquée en prod — cf. MIGRATIONS_A_APPLIQUER.sql / CLAUDE.md). Permet un
 * repli dégradé plutôt qu'un 500 sur tout le flux d'évaluation.
 */
export function isMissingColumnError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  const code = String(e.code ?? "");
  // PostgREST: PGRST204 = colonne absente du cache de schéma.
  // Postgres:  42703    = undefined_column.
  return code === "PGRST204" || code === "42703";
}
