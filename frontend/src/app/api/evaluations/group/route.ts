import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
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

  if (!user.isAdmin) {
    const { data: validSlot } = await supabaseAdmin
      .from("slot_member_assignments")
      .select(
        "slot:evaluation_slots!inner(id, epreuve_id, enrollments:slot_enrollments(candidate_id, status))",
      )
      .eq("member_id", user.id);

    const isAssigned = (validSlot || []).some((row: any) => {
      const s = row.slot;
      if (!s || s.epreuve_id !== epreuveId) return false;
      return (s.enrollments || [])
        .filter((e: any) => !e.status || e.status === "active")
        .some((e: any) => e.candidate_id === candidateId);
    });

    if (!isAssigned) {
      return Response.json(
        { error: "Vous n'êtes pas assigné à un créneau de cette épreuve." },
        { status: 403 },
      );
    }
  }

  const { data, error } = await supabaseAdmin
    .from("candidate_evaluations")
    .select("*, last_editor:members!last_edited_by(first_name, last_name, email)")
    .eq("candidate_id", candidateId)
    .eq("epreuve_id", epreuveId)
    .eq("is_group", true)
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return Response.json({ exists: false }, { status: 200 });
  }

  return Response.json({
    exists: true,
    id: data.id,
    scores:
      typeof data.scores === "string"
        ? JSON.parse(data.scores || "{}")
        : data.scores,
    comment: data.comment || "",
    updatedAt: data.updated_at || data.created_at,
    lastEditor: data.last_editor
      ? {
          firstName: data.last_editor.first_name,
          lastName: data.last_editor.last_name,
          email: data.last_editor.email,
        }
      : null,
  });
}
