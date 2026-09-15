import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { canEvaluate, resolveCandidateSlot } from "@/lib/evaluation-access";
import {
  normalizeScores,
  scoreValidationMessage,
  validateScores,
} from "@/lib/evaluation-criteria";
import {
  GROUP_EVALUATION_MAX,
  GROUP_EVALUATION_QUESTIONS,
} from "@/lib/group-evaluation-criteria";
import { NextRequest } from "next/server";

// ── Évaluation DU GROUPE sur une épreuve de groupe (business game) ─────────
//
// Une seule grille par CRÉNEAU (pas par candidat) : elle décrit le travail du
// groupe, pas celui d'un candidat. Le premier examinateur du créneau qui
// enregistre prend la main ; les autres la consultent en lecture seule. Cette
// note n'entre PAS dans la moyenne des candidats — elle éclaire la délibération.
//
// L'accès passe par le couple (candidat, épreuve) parce que c'est ce que
// l'écran de notation connaît : le créneau en est déduit côté serveur, jamais
// envoyé par le client.

interface Resolved {
  slotId: string;
  /** Réponse d'erreur déjà prête, quand la résolution échoue. */
  error?: Response;
}

/** Table absente : la migration group_evaluations n'est pas encore appliquée. */
function isMissingTableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown };
  // PostgREST PGRST205 = table inconnue du cache de schéma ; 42P01 = undefined_table.
  return String(e.code ?? "") === "PGRST205" || String(e.code ?? "") === "42P01";
}

const MIGRATION_PENDING = {
  error:
    "L'évaluation de groupe n'est pas encore activée en base (migration group_evaluations à appliquer).",
  code: "MIGRATION_PENDING",
};

/**
 * Vérifie les droits et remonte le créneau de ce candidat sur cette épreuve.
 * Refuse toute épreuve qui n'est pas « de groupe » : la grille ne s'applique
 * qu'aux business games.
 */
async function resolveGroupSlot(
  req: NextRequest,
  candidateId: string | null,
  epreuveId: string | null,
): Promise<Resolved> {
  const user = getTokenFromRequest(req);
  if (!user) return { slotId: "", error: unauthorized() };
  if (user.role !== "member") {
    return {
      slotId: "",
      error: Response.json({ error: "Accès interdit" }, { status: 403 }),
    };
  }
  if (!candidateId || !epreuveId) {
    return {
      slotId: "",
      error: Response.json(
        { error: "candidateId et epreuveId requis" },
        { status: 400 },
      ),
    };
  }

  const allowed = await canEvaluate(
    user.id,
    candidateId,
    epreuveId,
    user.isAdmin,
  );
  if (!allowed) {
    return {
      slotId: "",
      error: Response.json(
        { error: "Vous n'êtes pas assigné à un créneau de cette épreuve." },
        { status: 403 },
      ),
    };
  }

  const { data: epreuve } = await supabaseAdmin
    .from("epreuves")
    .select("is_group_epreuve")
    .eq("id", epreuveId)
    .single();

  if (epreuve?.is_group_epreuve !== true) {
    return {
      slotId: "",
      error: Response.json(
        { error: "Cette épreuve n'est pas une épreuve de groupe." },
        { status: 400 },
      ),
    };
  }

  const slot = await resolveCandidateSlot(candidateId, epreuveId);
  if (!slot) {
    return {
      slotId: "",
      error: Response.json(
        {
          error:
            "Ce candidat n'est inscrit sur aucun créneau de cette épreuve.",
          code: "NO_SLOT",
        },
        { status: 404 },
      ),
    };
  }

  return { slotId: slot.slotId };
}

/** Met en forme une ligne group_evaluations pour le client. */
function serialize(row: any, viewerId: string, isAdmin: boolean) {
  const owner = row.owner;
  return {
    exists: true,
    id: row.id,
    slotId: row.slot_id,
    scores:
      typeof row.scores === "string"
        ? JSON.parse(row.scores || "{}")
        : row.scores || {},
    comment: row.comment || "",
    updatedAt: row.updated_at || row.created_at,
    ownerId: row.member_id,
    isMine: row.member_id === viewerId,
    owner: owner
      ? {
          firstName: owner.first_name || "",
          lastName: owner.last_name || "",
          email: owner.email,
        }
      : null,
    // « Premier arrivé » : seul l'examinateur qui a pris la grille (ou un
    // admin) peut la modifier. Les autres la consultent.
    canEdit: isAdmin || row.member_id === viewerId,
  };
}

const SELECT = "*, owner:members!member_id(first_name, last_name, email)";

// GET /api/evaluations/group-note?candidateId=X&epreuveId=Y
export async function GET(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();

  const { searchParams } = req.nextUrl;
  const candidateId = searchParams.get("candidateId");
  const epreuveId = searchParams.get("epreuveId");

  const resolved = await resolveGroupSlot(req, candidateId, epreuveId);
  if (resolved.error) return resolved.error;

  const { data, error } = await supabaseAdmin
    .from("group_evaluations")
    .select(SELECT)
    .eq("slot_id", resolved.slotId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return Response.json(MIGRATION_PENDING, { status: 503 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  const base = {
    questions: GROUP_EVALUATION_QUESTIONS,
    maxTotal: GROUP_EVALUATION_MAX,
    slotId: resolved.slotId,
  };

  if (!data) {
    return Response.json({ ...base, exists: false, canEdit: true });
  }

  return Response.json({ ...base, ...serialize(data, user.id, user.isAdmin === true) });
}

// POST /api/evaluations/group-note — crée ou met à jour la grille du créneau.
// Body : { candidateId, epreuveId, scores, comment }
export async function POST(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Corps de requête invalide" }, { status: 400 });
  }

  const { candidateId, epreuveId, scores, comment } = body || {};
  const resolved = await resolveGroupSlot(req, candidateId, epreuveId);
  if (resolved.error) return resolved.error;

  // Barème : chaque note doit tenir dans [0, points max du critère] — même
  // règle que les évaluations individuelles (lib/evaluation-criteria).
  const invalid = validateScores(GROUP_EVALUATION_QUESTIONS, scores);
  if (invalid) {
    return Response.json(
      { error: scoreValidationMessage(invalid) },
      { status: 400 },
    );
  }
  const normalized = normalizeScores(scores, GROUP_EVALUATION_QUESTIONS);
  const cleanComment = typeof comment === "string" ? comment : "";

  const { data: existing, error: readError } = await supabaseAdmin
    .from("group_evaluations")
    .select(SELECT)
    .eq("slot_id", resolved.slotId)
    .maybeSingle();

  if (readError) {
    if (isMissingTableError(readError)) {
      return Response.json(MIGRATION_PENDING, { status: 503 });
    }
    return Response.json({ error: readError.message }, { status: 500 });
  }

  if (existing) {
    // Verrou « premier arrivé » : la grille appartient à celui qui l'a
    // commencée. Un admin peut toujours corriger.
    if (!user.isAdmin && existing.member_id !== user.id) {
      const owner = (existing as any).owner;
      const who = owner
        ? `${owner.first_name || ""} ${owner.last_name || ""}`.trim() ||
          owner.email
        : "un autre examinateur";
      return Response.json(
        {
          error: `L'évaluation du groupe est déjà remplie par ${who}. Vous pouvez la consulter mais pas la modifier.`,
          code: "GROUP_NOTE_LOCKED",
        },
        { status: 403 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("group_evaluations")
      .update({
        scores: normalized,
        comment: cleanComment,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select(SELECT)
      .single();

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json(serialize(data, user.id, user.isAdmin === true));
  }

  const { data, error } = await supabaseAdmin
    .from("group_evaluations")
    .insert({
      slot_id: resolved.slotId,
      epreuve_id: epreuveId,
      member_id: user.id,
      scores: normalized,
      comment: cleanComment,
    })
    .select(SELECT)
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      return Response.json(MIGRATION_PENDING, { status: 503 });
    }
    // 23505 : un co-examinateur a créé la grille au même instant. L'index
    // unique sur slot_id est le verrou ; on rend la grille du gagnant.
    if (String((error as any).code) === "23505") {
      const { data: winner } = await supabaseAdmin
        .from("group_evaluations")
        .select(SELECT)
        .eq("slot_id", resolved.slotId)
        .maybeSingle();
      return Response.json(
        {
          error:
            "Un autre examinateur a ouvert l'évaluation du groupe au même moment : sa saisie s'affiche.",
          code: "GROUP_NOTE_LOCKED",
          id: winner?.id ?? null,
        },
        { status: 409 },
      );
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(serialize(data, user.id, user.isAdmin === true));
}
