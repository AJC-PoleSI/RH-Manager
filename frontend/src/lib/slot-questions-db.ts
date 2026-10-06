import { supabaseAdmin } from "@/lib/supabase";
import { isActiveEnrollment } from "@/lib/enrollment";
import { isFinalizedEvaluation } from "@/lib/evaluation-finalized";

/**
 * Question de la banque choisie pour un CRÉNEAU (table `slot_questions`,
 * migration supabase-migration-tour3-notation.sql). Elle est partagée par
 * tous les examinateurs du créneau : les trois jurys d'un groupe notent la
 * réponse à la même question. Cf. lib/problem-bank.ts.
 */

export interface SlotQuestion {
  questionKey: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** Table absente : la migration n'est pas encore appliquée. */
export function isMissingTableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = String((err as { code?: unknown }).code ?? "");
  // PGRST205 = table inconnue du cache de schéma ; 42P01 = undefined_table.
  return code === "PGRST205" || code === "42P01";
}

/**
 * Question enregistrée pour ce créneau, ou null. `missingTable` signale une
 * migration pas encore appliquée (l'appelant répond 503 plutôt que 500).
 */
export async function readSlotQuestion(
  slotId: string,
): Promise<{ question: SlotQuestion | null; missingTable: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("slot_questions")
    .select("question_key, updated_by, updated_at")
    .eq("slot_id", slotId)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return { question: null, missingTable: true };
    throw error;
  }
  return {
    question: data
      ? {
          questionKey: data.question_key,
          updatedBy: data.updated_by ?? null,
          updatedAt: data.updated_at ?? null,
        }
      : null,
    missingTable: false,
  };
}

/**
 * La question d'un créneau est verrouillée dès qu'UNE note a été validée sur
 * ce créneau pour cette épreuve : changer la question après coup rendrait
 * faux le décompte des pistes déjà enregistré (brief F3).
 */
export async function isSlotQuestionLocked(
  slotId: string,
  epreuveId: string,
): Promise<boolean> {
  const { data: enrollments, error: enrollError } = await supabaseAdmin
    .from("slot_enrollments")
    .select("candidate_id, status")
    .eq("slot_id", slotId);
  if (enrollError) throw enrollError;
  const candidateIds = (enrollments || [])
    .filter((e: any) => isActiveEnrollment(e.status))
    .map((e: any) => e.candidate_id);
  if (candidateIds.length === 0) return false;

  const { data: evals, error } = await supabaseAdmin
    .from("candidate_evaluations")
    .select("scores, comment")
    .eq("epreuve_id", epreuveId)
    .in("candidate_id", candidateIds);
  if (error) throw error;
  return (evals || []).some(isFinalizedEvaluation);
}

/** Enregistre (ou remplace) la question du créneau. */
export async function writeSlotQuestion(
  slotId: string,
  questionKey: string,
  memberId: string,
): Promise<{ missingTable: boolean }> {
  const { error } = await supabaseAdmin.from("slot_questions").upsert(
    {
      slot_id: slotId,
      question_key: questionKey,
      updated_by: memberId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "slot_id" },
  );
  if (error) {
    if (isMissingTableError(error)) return { missingTable: true };
    throw error;
  }
  return { missingTable: false };
}
