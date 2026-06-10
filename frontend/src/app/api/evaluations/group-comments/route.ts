import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import {
  resolveCandidateSlot,
  isMemberAssignedToSlot,
} from "@/lib/evaluation-access";
import { NextRequest } from "next/server";

// GET /api/evaluations/group-comments?candidateId=X&epreuveId=Y
// Fil de commentaires partagé entre les examinateurs du créneau (épreuve de
// groupe) où le candidat est inscrit. Seuls les membres assignés au créneau
// y ont accès. Admins bypass.
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

  const slot = await resolveCandidateSlot(candidateId, epreuveId);
  if (!slot) {
    // Pas d'inscription active : pas de fil de groupe à afficher.
    return Response.json({ slotId: null, comments: [] });
  }

  if (!user.isAdmin) {
    const assigned = await isMemberAssignedToSlot(user.id, slot.slotId);
    if (!assigned) {
      return Response.json(
        { error: "Vous n'êtes pas assigné à un créneau de cette épreuve." },
        { status: 403 },
      );
    }
  }

  const { data, error } = await supabaseAdmin
    .from("group_comments")
    .select(
      "id, comment, created_at, member_id, member:members!member_id(first_name, last_name, email)",
    )
    .eq("slot_id", slot.slotId)
    .order("created_at", { ascending: true });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    slotId: slot.slotId,
    comments: (data || []).map((c: any) => ({
      id: c.id,
      comment: c.comment,
      createdAt: c.created_at,
      isMine: c.member_id === user.id,
      author: c.member
        ? {
            firstName: c.member.first_name || "",
            lastName: c.member.last_name || "",
            email: c.member.email,
          }
        : null,
    })),
  });
}

// POST /api/evaluations/group-comments
// Body: { candidateId, epreuveId, comment }
// Ajoute un commentaire au fil du créneau de l'épreuve de groupe.
export async function POST(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (user.role !== "member") {
    return Response.json({ error: "Accès interdit" }, { status: 403 });
  }

  try {
    const { candidateId, epreuveId, comment } = await req.json();

    if (!candidateId || !epreuveId || !comment?.trim()) {
      return Response.json(
        { error: "candidateId, epreuveId et comment requis" },
        { status: 400 },
      );
    }

    const slot = await resolveCandidateSlot(candidateId, epreuveId);
    if (!slot) {
      return Response.json(
        { error: "Aucune inscription active pour ce candidat sur cette épreuve." },
        { status: 404 },
      );
    }

    if (!user.isAdmin) {
      const assigned = await isMemberAssignedToSlot(user.id, slot.slotId);
      if (!assigned) {
        return Response.json(
          { error: "Vous n'êtes pas assigné à un créneau de cette épreuve." },
          { status: 403 },
        );
      }
    }

    const { data, error } = await supabaseAdmin
      .from("group_comments")
      .insert({
        slot_id: slot.slotId,
        epreuve_id: epreuveId,
        member_id: user.id,
        comment: comment.trim(),
      })
      .select("id, comment, created_at")
      .single();

    if (error) throw error;

    return Response.json(
      {
        id: data.id,
        comment: data.comment,
        createdAt: data.created_at,
        isMine: true,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Group comment POST error:", error);
    return Response.json(
      { error: "Erreur lors de l'ajout du commentaire" },
      { status: 500 },
    );
  }
}
