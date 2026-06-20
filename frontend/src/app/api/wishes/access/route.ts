import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { isCandidateAdmittedTour1 } from "@/lib/admission";
import { NextRequest } from "next/server";

// GET /api/wishes/access — le candidat connecté a-t-il débloqué ses choix
// de pôles (admis au tour 2) ? Les membres/admins ont toujours accès.
// Renvoie aussi `locked` : true si les vœux ont été confirmés définitivement
// au tour 3 (plus modifiables côté candidat).
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  if (payload.role !== "candidate") {
    return Response.json({ admitted: true, locked: false });
  }

  const admitted = await isCandidateAdmittedTour1(payload.id);

  const { data: cand } = await supabaseAdmin
    .from("candidates")
    .select("wishes_locked_at")
    .eq("id", payload.id)
    .maybeSingle();

  return Response.json({ admitted, locked: !!cand?.wishes_locked_at });
}
