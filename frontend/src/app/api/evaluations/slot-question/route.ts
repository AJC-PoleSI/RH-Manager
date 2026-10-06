import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { canEvaluate, resolveCandidateSlot } from "@/lib/evaluation-access";
import { parseQuestions } from "@/lib/evaluation-criteria";
import {
  bankMatchesGrid,
  findProblemQuestion,
  parseProblemBank,
  type ProblemBank,
} from "@/lib/problem-bank";
import {
  isSlotQuestionLocked,
  readSlotQuestion,
  writeSlotQuestion,
} from "@/lib/slot-questions-db";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/evaluations/slot-question?candidateId=X&epreuveId=Y
// PUT /api/evaluations/slot-question  { candidateId, epreuveId, questionKey }
//
// Question de la banque posée au groupe pendant l'échange groupé (Tour 3,
// brief F3). Elle est stockée par CRÉNEAU et partagée par ses examinateurs.
// Comme pour la note de groupe, l'accès passe par le couple (candidat,
// épreuve) : le créneau est résolu côté serveur, jamais envoyé par le client.

const MIGRATION_PENDING = {
  error:
    "Le choix de la question n'est pas encore activé en base (migration tour3-notation à appliquer).",
  code: "MIGRATION_PENDING",
};

type Resolved =
  | { error: Response }
  | { error: null; slotId: string; bank: ProblemBank; memberId: string };

async function resolve(
  req: NextRequest,
  candidateId: string | null | undefined,
  epreuveId: string | null | undefined,
): Promise<Resolved> {
  const user = getTokenFromRequest(req);
  if (!user) return { error: unauthorized() };
  if (user.role !== "member") {
    return { error: Response.json({ error: "Accès interdit" }, { status: 403 }) };
  }
  if (!candidateId || !epreuveId) {
    return {
      error: Response.json(
        { error: "candidateId et epreuveId requis" },
        { status: 400 },
      ),
    };
  }
  if (!(await canEvaluate(user.id, candidateId, epreuveId, user.isAdmin))) {
    return {
      error: Response.json(
        { error: "Vous n'êtes pas examinateur de ce candidat sur cette épreuve." },
        { status: 403 },
      ),
    };
  }

  // select("*") : problem_bank peut ne pas encore exister en base.
  const { data: epreuve } = await supabaseAdmin
    .from("epreuves")
    .select("*")
    .eq("id", epreuveId)
    .maybeSingle();
  const bank = parseProblemBank(epreuve?.problem_bank);
  if (!bank || !bankMatchesGrid(bank, parseQuestions(epreuve?.evaluation_questions))) {
    return {
      error: Response.json(
        { error: "Cette épreuve n'a pas de banque de questions.", code: "NO_BANK" },
        { status: 404 },
      ),
    };
  }

  const slot = await resolveCandidateSlot(candidateId, epreuveId);
  if (!slot) {
    return {
      error: Response.json(
        {
          error: "Ce candidat n'est inscrit sur aucun créneau de cette épreuve.",
          code: "NO_SLOT",
        },
        { status: 404 },
      ),
    };
  }
  return { error: null, slotId: slot.slotId, bank, memberId: user.id };
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  try {
    const r = await resolve(
      req,
      searchParams.get("candidateId"),
      searchParams.get("epreuveId"),
    );
    if (r.error) return r.error;

    const { question, missingTable } = await readSlotQuestion(r.slotId);
    if (missingTable) return Response.json(MIGRATION_PENDING, { status: 503 });
    const locked = question
      ? await isSlotQuestionLocked(r.slotId, searchParams.get("epreuveId")!)
      : false;

    return Response.json({
      slotId: r.slotId,
      questionKey: question?.questionKey ?? null,
      updatedAt: question?.updatedAt ?? null,
      locked,
    });
  } catch (error) {
    console.error("GET /evaluations/slot-question error:", error);
    return Response.json(
      { error: "Impossible de lire la question du créneau." },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Corps de requête invalide" }, { status: 400 });
  }
  const { candidateId, epreuveId, questionKey } = body || {};

  try {
    const r = await resolve(req, candidateId, epreuveId);
    if (r.error) return r.error;

    const question = findProblemQuestion(
      r.bank,
      typeof questionKey === "string" ? questionKey : null,
    );
    if (!question) {
      return Response.json(
        { error: "Question inconnue pour cette épreuve." },
        { status: 400 },
      );
    }

    const current = await readSlotQuestion(r.slotId);
    if (current.missingTable) {
      return Response.json(MIGRATION_PENDING, { status: 503 });
    }
    if (current.question?.questionKey === question.key) {
      return Response.json({
        slotId: r.slotId,
        questionKey: question.key,
        updatedAt: current.question.updatedAt,
        locked: await isSlotQuestionLocked(r.slotId, epreuveId),
      });
    }
    // Une note est déjà validée sur ce créneau : ses pistes ont été comptées
    // pour la question en place, on ne la change plus.
    if (current.question && (await isSlotQuestionLocked(r.slotId, epreuveId))) {
      return Response.json(
        {
          error:
            "Une note a déjà été validée sur ce créneau : la question ne peut plus changer. Contactez un responsable recrutement.",
          code: "SLOT_QUESTION_LOCKED",
          questionKey: current.question.questionKey,
        },
        { status: 409 },
      );
    }

    const written = await writeSlotQuestion(r.slotId, question.key, r.memberId);
    if (written.missingTable) {
      return Response.json(MIGRATION_PENDING, { status: 503 });
    }
    // Vérification puis écriture ne sont pas atomiques : si une note a été
    // validée entre les deux, on remet la question d'avant (celle sur
    // laquelle la note a été comptée) et on refuse.
    if (current.question && (await isSlotQuestionLocked(r.slotId, epreuveId))) {
      await writeSlotQuestion(r.slotId, current.question.questionKey, r.memberId);
      return Response.json(
        {
          error:
            "Une note vient d'être validée sur ce créneau : la question ne peut plus changer.",
          code: "SLOT_QUESTION_LOCKED",
          questionKey: current.question.questionKey,
        },
        { status: 409 },
      );
    }
    return Response.json({
      slotId: r.slotId,
      questionKey: question.key,
      updatedAt: new Date().toISOString(),
      locked: false,
    });
  } catch (error) {
    console.error("PUT /evaluations/slot-question error:", error);
    return Response.json(
      { error: "Impossible d'enregistrer la question du créneau." },
      { status: 500 },
    );
  }
}
