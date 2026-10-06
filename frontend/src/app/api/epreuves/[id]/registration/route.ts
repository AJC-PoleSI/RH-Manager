import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { getEliminationTour, eliminatedResponse } from "@/lib/elimination-db";
import { getToursByNumber } from "@/lib/tour-status";
import { planningVisibleToCandidates } from "@/lib/slot-release";
import {
  registrationBlockReason,
  type RegistrationAction,
} from "@/lib/distanciel";
import { NextRequest } from "next/server";

// POST   /api/epreuves/[id]/registration — le candidat s'inscrit à une épreuve
//                                          en distanciel (aucun créneau)
// DELETE /api/epreuves/[id]/registration — il s'en désinscrit
//
// SECURITY : le candidat est TOUJOURS celui du jeton, jamais un id envoyé par
// le client. Règles (tour, ouverture du planning, deadline) dans
// lib/distanciel.ts ; l'élimination est vérifiée comme pour les créneaux.

async function guard(
  req: NextRequest,
  epreuveId: string,
  action: RegistrationAction,
): Promise<Response | { candidateId: string }> {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (payload.role !== "candidate") {
    return Response.json({ error: "Candidate auth required" }, { status: 401 });
  }
  const candidateId = payload.id;

  if ((await getEliminationTour(candidateId)) != null) {
    return eliminatedResponse();
  }

  const { data: epreuve, error } = await supabaseAdmin
    .from("epreuves")
    .select("id, tour, is_distanciel, inscription_deadline")
    .eq("id", epreuveId)
    .maybeSingle();
  if (error) throw error;
  if (!epreuve) {
    return Response.json({ error: "Épreuve introuvable" }, { status: 404 });
  }

  const [tours, planningVisible] = await Promise.all([
    getToursByNumber(),
    planningVisibleToCandidates(),
  ]);
  const reason = registrationBlockReason({
    action,
    isDistanciel: epreuve.is_distanciel === true,
    tourStatus: tours[epreuve.tour]?.status,
    planningVisible,
    deadline: epreuve.inscription_deadline ?? null,
    now: new Date(),
  });
  if (reason) return Response.json({ error: reason }, { status: 400 });

  return { candidateId };
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const g = await guard(req, params.id, "register");
    if (g instanceof Response) return g;

    // Idempotent : une deuxième inscription ne crée pas de doublon.
    const { error } = await supabaseAdmin
      .from("epreuve_registrations")
      .upsert(
        { epreuve_id: params.id, candidate_id: g.candidateId },
        { onConflict: "epreuve_id,candidate_id", ignoreDuplicates: true },
      );
    if (error) throw error;

    return Response.json({ registered: true });
  } catch (error) {
    console.error("POST /epreuves/[id]/registration error:", error);
    return Response.json(
      { error: "Inscription impossible pour le moment." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const g = await guard(req, params.id, "unregister");
    if (g instanceof Response) return g;

    const { error } = await supabaseAdmin
      .from("epreuve_registrations")
      .delete()
      .eq("epreuve_id", params.id)
      .eq("candidate_id", g.candidateId);
    if (error) throw error;

    return Response.json({ registered: false });
  } catch (error) {
    console.error("DELETE /epreuves/[id]/registration error:", error);
    return Response.json(
      { error: "Désinscription impossible pour le moment." },
      { status: 500 },
    );
  }
}
