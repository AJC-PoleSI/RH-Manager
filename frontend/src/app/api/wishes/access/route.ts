import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { isCandidateAdmittedTour1 } from "@/lib/admission";
import { getEliminationTour } from "@/lib/elimination-db";
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

  // Un refusé à un tour ultérieur (ex. tour 2) reste « admis au tour 1 »
  // mais n'a plus de vœux à exprimer.
  const admitted =
    (await isCandidateAdmittedTour1(payload.id)) &&
    (await getEliminationTour(payload.id)) == null;

  const { data: cand } = await supabaseAdmin
    .from("candidates")
    .select("wishes_locked_at")
    .eq("id", payload.id)
    .maybeSingle();

  return Response.json({ admitted, locked: !!cand?.wishes_locked_at });
}
