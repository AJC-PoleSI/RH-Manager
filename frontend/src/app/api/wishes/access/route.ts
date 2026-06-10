import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { isCandidateAdmittedTour1 } from "@/lib/admission";
import { NextRequest } from "next/server";

// GET /api/wishes/access — le candidat connecté a-t-il débloqué ses choix
// de pôles (admis au tour 2) ? Les membres/admins ont toujours accès.
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  if (payload.role !== "candidate") {
    return Response.json({ admitted: true });
  }

  const admitted = await isCandidateAdmittedTour1(payload.id);
  return Response.json({ admitted });
}
