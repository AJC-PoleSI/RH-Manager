import { supabaseAdmin } from "@/lib/supabase";
import { getToursByNumber } from "@/lib/tour-status";
import {
  officialEliminationTour,
  pickRefusalMessage,
  refusalMessageKey,
  candidateRefusalMessageKey,
} from "@/lib/elimination";

type ToursByNumber = Awaited<ReturnType<typeof getToursByNumber>>;

/**
 * Tour auquel le candidat est officiellement éliminé, ou null s'il est encore
 * en lice. `toursByNumber` évite une relecture quand l'appelant l'a déjà.
 *
 * En cas de panne de lecture, on laisse passer (null) : bloquer à tort un
 * candidat en lice serait pire que de montrer un créneau à un refusé.
 */
export async function getEliminationTour(
  candidateId: string,
  toursByNumber?: ToursByNumber,
): Promise<number | null> {
  const [{ data: delib, error }, tours] = await Promise.all([
    supabaseAdmin
      .from("deliberations")
      .select("tour1_status, tour2_status, tour3_status")
      .eq("candidate_id", candidateId)
      .maybeSingle(),
    toursByNumber ? Promise.resolve(toursByNumber) : getToursByNumber(),
  ]);
  if (error) {
    console.error("getEliminationTour: lecture délibération", error);
    return null;
  }
  const statuses: Record<number, string> = {};
  for (const [n, t] of Object.entries(tours)) statuses[Number(n)] = t.status;
  return officialEliminationTour(delib, statuses);
}

/** Message de refus tel qu'envoyé par email au candidat pour ce tour. */
export async function getRefusalMessage(
  candidateId: string,
  tour: number,
): Promise<string> {
  const individualKey = candidateRefusalMessageKey(tour, candidateId);
  const globalKey = refusalMessageKey(tour);
  const { data } = await supabaseAdmin
    .from("system_settings")
    .select("key, value")
    .in("key", [individualKey, globalKey]);
  const byKey = new Map((data || []).map((r: any) => [r.key, r.value]));
  return pickRefusalMessage(byKey.get(individualKey), byKey.get(globalKey));
}

/** Réponse standard d'une route candidat fermée aux éliminés. */
export function eliminatedResponse() {
  return Response.json(
    {
      error:
        "Vous n'avez pas été retenu(e) pour la suite du recrutement : les inscriptions ne vous sont plus ouvertes.",
      eliminated: true,
    },
    { status: 403 },
  );
}
