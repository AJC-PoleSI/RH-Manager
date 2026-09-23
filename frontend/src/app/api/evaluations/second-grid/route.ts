import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { canEvaluate } from "@/lib/evaluation-access";
import {
  getTotalMaxPoints,
  normalizeScores,
  scoreValidationMessage,
  validateScores,
} from "@/lib/evaluation-criteria";
import {
  isSecondGridMigrationMissing,
  parseSecondGrid,
  type SecondGrid,
} from "@/lib/second-grid";
import { NextRequest } from "next/server";

// ── DEUXIÈME GRILLE d'une épreuve (ex. proposition commerciale) ────────────
//
// Une note par (candidat, épreuve), que n'importe quel examinateur du créneau
// peut remplir ou corriger à tout moment — y compris quand la note de
// l'entretien est déjà close : la propale arrive le lendemain. Cf.
// lib/second-grid.ts.
//
// L'accès passe par le couple (candidat, épreuve), jamais par un id de ligne
// envoyé par le client.

const SELECT =
  "*, editor:members!last_edited_by(first_name, last_name, email)";

interface Resolved {
  grid?: SecondGrid;
  /** Réponse prête : erreur, ou « pas de deuxième grille » (200). */
  response?: Response;
}

async function resolve(
  req: NextRequest,
  candidateId: string | null | undefined,
  epreuveId: string | null | undefined,
): Promise<Resolved & { userId?: string }> {
  const user = getTokenFromRequest(req);
  if (!user) return { response: unauthorized() };
  if (user.role !== "member") {
    return {
      response: Response.json({ error: "Accès interdit" }, { status: 403 }),
    };
  }
  if (!candidateId || !epreuveId) {
    return {
      response: Response.json(
        { error: "candidateId et epreuveId requis" },
        { status: 400 },
      ),
    };
  }

  const { data: epreuve, error } = await supabaseAdmin
    .from("epreuves")
    .select("secondary_grid")
    .eq("id", epreuveId)
    .maybeSingle();

  // Migration pas encore appliquée, ou épreuve sans deuxième grille : rien à
  // afficher. Réponse 200 pour que l'écran de notation masque simplement le
  // panneau, sans message d'erreur.
  if (error && !isSecondGridMigrationMissing(error)) {
    return {
      response: Response.json({ error: error.message }, { status: 500 }),
    };
  }
  const grid = error ? null : parseSecondGrid(epreuve?.secondary_grid);
  if (!grid) {
    return { response: Response.json({ available: false }) };
  }

  const allowed = await canEvaluate(
    user.id,
    candidateId,
    epreuveId,
    user.isAdmin,
  );
  if (!allowed) {
    return {
      response: Response.json(
        {
          error:
            "Vous ne pouvez évaluer que les candidats inscrits sur un créneau auquel vous êtes assigné, pour cette épreuve.",
        },
        { status: 403 },
      ),
    };
  }

  return { grid, userId: user.id };
}

function serialize(grid: SecondGrid, row: any | null) {
  const editor = row?.editor;
  return {
    available: true,
    title: grid.title,
    questions: grid.questions,
    maxTotal: getTotalMaxPoints(grid.questions),
    exists: !!row,
    id: row?.id ?? null,
    scores:
      typeof row?.scores === "string"
        ? JSON.parse(row.scores || "{}")
        : row?.scores || {},
    comment: row?.comment || "",
    updatedAt: row ? row.updated_at || row.created_at : null,
    lastEditor: editor
      ? {
          firstName: editor.first_name || "",
          lastName: editor.last_name || "",
          email: editor.email,
        }
      : null,
  };
}

// GET /api/evaluations/second-grid?candidateId=X&epreuveId=Y
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const candidateId = searchParams.get("candidateId");
  const epreuveId = searchParams.get("epreuveId");

  const resolved = await resolve(req, candidateId, epreuveId);
  if (resolved.response) return resolved.response;
  const grid = resolved.grid!;

  const { data, error } = await supabaseAdmin
    .from("secondary_evaluations")
    .select(SELECT)
    .eq("candidate_id", candidateId!)
    .eq("epreuve_id", epreuveId!)
    .maybeSingle();

  if (error) {
    if (isSecondGridMigrationMissing(error)) {
      return Response.json({ available: false });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(serialize(grid, data));
}

// POST /api/evaluations/second-grid — crée ou met à jour la note.
// Body : { candidateId, epreuveId, scores, comment }
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Corps de requête invalide" }, { status: 400 });
  }
  const { candidateId, epreuveId, scores, comment } = body || {};

  const resolved = await resolve(req, candidateId, epreuveId);
  if (resolved.response) return resolved.response;
  const grid = resolved.grid!;
  const userId = resolved.userId!;

  // Même barème que partout : chaque note dans [0, points max du critère].
  const invalid = validateScores(grid.questions, scores);
  if (invalid) {
    return Response.json(
      { error: scoreValidationMessage(invalid) },
      { status: 400 },
    );
  }

  const row = {
    candidate_id: candidateId,
    epreuve_id: epreuveId,
    scores: normalizeScores(scores, grid.questions),
    comment:
      typeof comment === "string" ? comment.substring(0, 5000) : "",
    last_edited_by: userId,
    updated_at: new Date().toISOString(),
  };

  // Upsert sur l'index unique (candidate_id, epreuve_id) : deux examinateurs
  // qui saisissent en même temps écrivent la même ligne, le dernier gagne.
  // `created_by` n'est posé qu'à la création (absent de l'update).
  const { data: existing, error: readError } = await supabaseAdmin
    .from("secondary_evaluations")
    .select("id")
    .eq("candidate_id", candidateId)
    .eq("epreuve_id", epreuveId)
    .maybeSingle();

  if (readError) {
    return Response.json({ error: readError.message }, { status: 500 });
  }

  const query = existing
    ? supabaseAdmin
        .from("secondary_evaluations")
        .update(row)
        .eq("id", existing.id)
    : supabaseAdmin
        .from("secondary_evaluations")
        .upsert(
          { ...row, created_by: userId },
          { onConflict: "candidate_id,epreuve_id" },
        );

  const { data, error } = await query.select(SELECT).single();
  if (error) {
    console.error("[second-grid] enregistrement impossible:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(serialize(grid, data));
}
