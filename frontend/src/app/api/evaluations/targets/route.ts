import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { isMemberAssignedToSlot } from "@/lib/evaluation-access";
import { NextRequest } from "next/server";

// GET /api/evaluations/targets?slotId=X
// Liste le cochage "qui examine qui" d'un créneau : pour chaque candidat,
// quels examinateurs ont déclaré l'observer. Réservé aux membres assignés
// au créneau. Admins bypass.
export async function GET(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (user.role !== "member") {
    return Response.json({ error: "Accès interdit" }, { status: 403 });
  }

  const slotId = req.nextUrl.searchParams.get("slotId");
  if (!slotId) {
    return Response.json({ error: "slotId requis" }, { status: 400 });
  }

  if (!user.isAdmin) {
    const assigned = await isMemberAssignedToSlot(user.id, slotId);
    if (!assigned) {
      return Response.json(
        { error: "Vous n'êtes pas assigné à ce créneau." },
        { status: 403 },
      );
    }
  }

  const { data, error } = await supabaseAdmin
    .from("examiner_targets")
    .select(
      "id, candidate_id, member_id, member:members!member_id(first_name, last_name, email)",
    )
    .eq("slot_id", slotId);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    targets: (data || []).map((t: any) => ({
      candidateId: t.candidate_id,
      memberId: t.member_id,
      isMe: t.member_id === user.id,
      member: t.member
        ? {
            firstName: t.member.first_name || "",
            lastName: t.member.last_name || "",
            email: t.member.email,
          }
        : null,
    })),
  });
}

// POST /api/evaluations/targets
// Body: { slotId, candidateId, on: boolean }
// Coche/décoche "j'examine ce candidat" pour le membre connecté.
export async function POST(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (user.role !== "member") {
    return Response.json({ error: "Accès interdit" }, { status: 403 });
  }

  try {
    const { slotId, candidateId, on } = await req.json();

    if (!slotId || !candidateId || typeof on !== "boolean") {
      return Response.json(
        { error: "slotId, candidateId et on (boolean) requis" },
        { status: 400 },
      );
    }

    if (!user.isAdmin) {
      const assigned = await isMemberAssignedToSlot(user.id, slotId);
      if (!assigned) {
        return Response.json(
          { error: "Vous n'êtes pas assigné à ce créneau." },
          { status: 403 },
        );
      }
    }

    if (on) {
      const { error } = await supabaseAdmin.from("examiner_targets").upsert(
        {
          slot_id: slotId,
          member_id: user.id,
          candidate_id: candidateId,
        },
        { onConflict: "slot_id,member_id,candidate_id", ignoreDuplicates: true },
      );
      if (error) throw error;
    } else {
      const { error } = await supabaseAdmin
        .from("examiner_targets")
        .delete()
        .eq("slot_id", slotId)
        .eq("member_id", user.id)
        .eq("candidate_id", candidateId);
      if (error) throw error;
    }

    return Response.json({ ok: true, on });
  } catch (error) {
    console.error("Examiner target POST error:", error);
    return Response.json(
      { error: "Erreur lors de la mise à jour du cochage" },
      { status: 500 },
    );
  }
}
