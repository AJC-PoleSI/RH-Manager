import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import {
  resolveCandidateSlot,
  isMemberAssignedToSlot,
} from "@/lib/evaluation-access";
import { NextRequest } from "next/server";

// GET /api/evaluations/peers?candidateId=X&epreuveId=Y
// Évaluations INDIVIDUELLES de tous les examinateurs pour ce candidat sur
// cette épreuve (de groupe) — pour que chaque examinateur voie les notes et
// commentaires de ses pairs en direct. Réservé aux membres assignés à un
// créneau de l'épreuve où le candidat est inscrit. Admins bypass.
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

  if (!user.isAdmin) {
    const slot = await resolveCandidateSlot(candidateId, epreuveId);
    if (!slot) {
      return Response.json({ evaluations: [] });
    }
    const assigned = await isMemberAssignedToSlot(user.id, slot.slotId);
    if (!assigned) {
      return Response.json(
        { error: "Vous n'êtes pas assigné à un créneau de cette épreuve." },
        { status: 403 },
      );
    }
  }

  const { data, error } = await supabaseAdmin
    .from("candidate_evaluations")
    .select(
      "id, scores, comment, created_at, updated_at, member_id, member:members!member_id(first_name, last_name, email)",
    )
    .eq("candidate_id", candidateId)
    .eq("epreuve_id", epreuveId)
    .eq("is_group", false)
    .order("created_at", { ascending: true });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    evaluations: (data || []).map((e: any) => ({
      id: e.id,
      scores:
        typeof e.scores === "string" ? JSON.parse(e.scores || "{}") : e.scores,
      comment: e.comment || "",
      createdAt: e.created_at,
      updatedAt: e.updated_at || e.created_at,
      isMine: e.member_id === user.id,
      author: e.member
        ? {
            firstName: e.member.first_name || "",
            lastName: e.member.last_name || "",
            email: e.member.email,
          }
        : null,
    })),
  });
}
