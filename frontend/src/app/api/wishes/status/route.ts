import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { getToursByNumber } from "@/lib/tour-status";
import {
  needsWishes,
  type ReminderCandidate,
  type ReminderDelib,
} from "@/lib/wishes-reminder";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/wishes/status — le candidat connecté doit-il remplir ses vœux ?
// Alimente le bandeau `WishesNudge` de l'accueil candidat.
//
// SECURITY : l'id vient du JWT, jamais du client — un candidat ne doit pas
// pouvoir sonder l'état des vœux d'un autre. Réservé aux candidats : pour le
// staff la question n'a pas de sens.
//
// La décision passe par `needsWishes` (module pur) pour partager EXACTEMENT
// le critère de la relance mail : un bandeau qui réclamerait des vœux à un
// candidat que le cron ignore (ou l'inverse) serait incompréhensible.
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (payload.role !== "candidate") return forbidden();
  const candidateId = payload.id;

  try {
    const [candRes, delibRes, wishRes, tours] = await Promise.all([
      supabaseAdmin
        .from("candidates")
        .select("id, email, first_name, wishes_locked_at")
        .eq("id", candidateId)
        .maybeSingle(),
      supabaseAdmin
        .from("deliberations")
        .select("candidate_id, tour1_status, tour2_status, tour3_status")
        .eq("candidate_id", candidateId)
        .maybeSingle(),
      // Seule l'existence d'un vœu compte : `head: true` évite de rapatrier
      // les lignes.
      supabaseAdmin
        .from("candidate_wishes")
        .select("candidate_id", { count: "exact", head: true })
        .eq("candidate_id", candidateId),
      getToursByNumber(),
    ]);
    if (candRes.error) throw candRes.error;
    if (delibRes.error) throw delibRes.error;
    if (wishRes.error) throw wishRes.error;
    if (!candRes.data) return Response.json({ needsWishes: false });

    const result = needsWishes(
      candRes.data as ReminderCandidate,
      (delibRes.data as ReminderDelib | null) ?? undefined,
      (wishRes.count ?? 0) > 0,
      tours[2]?.status,
    );
    return Response.json({ needsWishes: result });
  } catch (e) {
    console.error("GET wishes/status error:", e);
    return Response.json(
      { error: "Impossible de vérifier l'état des vœux" },
      { status: 500 },
    );
  }
}
