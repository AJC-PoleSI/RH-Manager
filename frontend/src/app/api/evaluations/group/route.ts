import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { canEvaluate, isMissingColumnError } from "@/lib/evaluation-access";
import { NextRequest } from "next/server";

// GET /api/evaluations/group?candidateId=X&epreuveId=Y
// Returns the existing group evaluation for this (candidate, epreuve) — or 404
// if none yet. Only members assigned to a slot of this épreuve where the
// candidate is enrolled may access it. Admins bypass.
export async function GET(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (user.role !== "member") {
    return Response.json({ error: "Accès interdit" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const candidateId = searchParams.get("candidateId");
  const epreuveId = searchParams.get("epreuveId");

  if (!candidateId || !epreuveId) {
    return Response.json(
      { error: "candidateId et epreuveId requis" },
      { status: 400 },
    );
  }

  const allowed = await canEvaluate(
    user.id,
    candidateId,
    epreuveId,
    user.isAdmin,
  );
  if (!allowed) {
    return Response.json(
      { error: "Vous n'êtes pas assigné à un créneau de cette épreuve." },
      { status: 403 },
    );
  }

  const baseSelect =
    "*, last_editor:members!last_edited_by(first_name, last_name, email), closer:members!closed_by(first_name, last_name, email), epreuves(is_group_epreuve)";

  let { data, error } = await supabaseAdmin
    .from("candidate_evaluations")
    .select(baseSelect)
    .eq("candidate_id", candidateId)
    .eq("epreuve_id", epreuveId)
    .eq("is_group", true)
    .maybeSingle();

  // Repli : colonnes closed_at/closed_by pas encore migrées en prod.
  if (error && isMissingColumnError(error)) {
    ({ data, error } = await supabaseAdmin
      .from("candidate_evaluations")
      .select(
        "*, last_editor:members!last_edited_by(first_name, last_name, email), epreuves(is_group_epreuve)",
      )
      .eq("candidate_id", candidateId)
      .eq("epreuve_id", epreuveId)
      .eq("is_group", true)
      .maybeSingle());
  }

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return Response.json({ exists: false }, { status: 200 });
  }

  const d = data as any;
  // Note collective d'une vraie épreuve "de groupe" : n'importe quel membre
  // assigné au créneau peut éditer (comportement historique). Note partagée
  // en binôme (épreuve individuelle, 2+ examinateurs) : seul l'auteur édite,
  // les autres sont en lecture seule (cf. règle miroir dans PUT /[id]).
  const isRealGroupEpreuve = d.epreuves?.is_group_epreuve === true;
  // Le requérant est déjà vérifié assigné au créneau plus haut (canEvaluate).
  const canEdit =
    !d.closed_at &&
    (user.isAdmin || d.member_id === user.id || isRealGroupEpreuve);

  return Response.json({
    exists: true,
    id: d.id,
    ownerId: d.member_id,
    isMine: d.member_id === user.id,
    scores:
      typeof d.scores === "string" ? JSON.parse(d.scores || "{}") : d.scores,
    comment: d.comment || "",
    updatedAt: d.updated_at || d.created_at,
    lastEditor: d.last_editor
      ? {
          firstName: d.last_editor.first_name,
          lastName: d.last_editor.last_name,
          email: d.last_editor.email,
        }
      : null,
    closedAt: d.closed_at || null,
    closedBy: d.closer
      ? {
          firstName: d.closer.first_name,
          lastName: d.closer.last_name,
          email: d.closer.email,
        }
      : null,
    canEdit,
  });
}
