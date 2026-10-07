import { resolveCandidateSlot } from "@/lib/evaluation-access";
import type { EvaluationCriterion } from "@/lib/evaluation-criteria";
import {
  bankMatchesGrid,
  normalizeProblemChecks,
  parseProblemBank,
  scoreFromChecks,
  type ProblemChecks,
} from "@/lib/problem-bank";
import { readSlotQuestion } from "@/lib/slot-questions-db";

/**
 * Banque de questions (Tour 3, échange groupé) à l'écriture d'une note —
 * partagé par POST /api/evaluations et PUT /api/evaluations/[id].
 *
 * La note du critère « Réponse à la problématique » n'est JAMAIS reprise du
 * client : elle est recalculée depuis les pistes cochées, qui doivent porter
 * sur la question choisie pour le créneau.
 *   - `required` (enregistrement définitif) : pistes obligatoires ;
 *   - brouillon (notation partie par partie) : pistes facultatives — sans
 *     elles, la note du critère est simplement retirée (pas encore notée).
 * Épreuve sans banque, ou banque qui ne vise pas la grille : rien ne change.
 */
export type ProblemChecksOutcome =
  | { ok: true; scores: unknown; checks: ProblemChecks | null }
  | { ok: false; response: Response };

export async function applyProblemChecks(o: {
  epreuveRow: any;
  questions: EvaluationCriterion[];
  scores: unknown;
  rawChecks: unknown;
  candidateId: string;
  epreuveId: string;
  required: boolean;
  /**
   * Notes déjà enregistrées (modification) : sans pistes envoyées, la note
   * du critère reste celle déjà calculée — une correction admin depuis la
   * fiche candidat n'envoie que les notes et ne doit pas l'effacer.
   */
  storedScores?: unknown;
}): Promise<ProblemChecksOutcome> {
  const bank = parseProblemBank(o.epreuveRow?.problem_bank);
  if (!bank || !bankMatchesGrid(bank, o.questions)) {
    return { ok: true, scores: o.scores, checks: null };
  }

  const parsedScores: Record<string, unknown> =
    typeof o.scores === "string"
      ? JSON.parse(o.scores || "{}")
      : ((o.scores as Record<string, unknown>) ?? {});
  const key = String(bank.criterionIndex);

  if (o.rawChecks == null) {
    if (o.required) {
      return {
        ok: false,
        response: Response.json(
          {
            error:
              "Les pistes de la « Réponse à la problématique » manquent : choisissez la question du créneau et cochez les pistes.",
            code: "PROBLEM_CHECKS_REQUIRED",
          },
          { status: 400 },
        ),
      };
    }
    // Sans pistes : la note du critère reste celle déjà enregistrée (s'il y
    // en a une), sinon le critère n'est pas encore noté. Jamais celle du client.
    const { [key]: _dropped, ...rest } = parsedScores;
    const stored: Record<string, unknown> =
      typeof o.storedScores === "string"
        ? JSON.parse(o.storedScores || "{}")
        : ((o.storedScores as Record<string, unknown>) ?? {});
    return {
      ok: true,
      scores: stored[key] !== undefined ? { ...rest, [key]: stored[key] } : rest,
      checks: null,
    };
  }

  const checks = normalizeProblemChecks(bank, o.rawChecks);
  if (!checks) {
    return {
      ok: false,
      response: Response.json(
        { error: "Question inconnue pour cette épreuve." },
        { status: 400 },
      ),
    };
  }
  const slot = await resolveCandidateSlot(o.candidateId, o.epreuveId);
  if (slot) {
    const { question } = await readSlotQuestion(slot.slotId);
    if (question && question.questionKey !== checks.questionKey) {
      return {
        ok: false,
        response: Response.json(
          {
            error:
              "La question du créneau a changé entre-temps : rechargez la page et recochez les pistes.",
            code: "SLOT_QUESTION_CHANGED",
          },
          { status: 409 },
        ),
      };
    }
  }
  return {
    ok: true,
    scores: { ...parsedScores, [key]: scoreFromChecks(bank, checks) },
    checks,
  };
}
