import { runDispatch } from "@/lib/dispatchService";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/dispatch/run
 *
 * Triggers the intelligent dispatch algorithm.
 *
 * Déclencheurs :
 *   - Admin clique "Publier" (avec epreuveId dans le body)
 *   - Membre sauvegarde ses disponibilités (sans epreuveId = global)
 *   - Appel API explicite
 *
 * Body (optionnel) :
 *   { epreuveId?: string }  — limiter le dispatch à une épreuve spécifique
 *   { dryRun?: boolean }    — SIMULER sans rien écrire (admin uniquement).
 *                             Renvoie le diff (added / removed) et la liste
 *                             des créneaux à candidats en sous-effectif, pour
 *                             que l'admin valide avant d'appliquer : un run
 *                             global rebrasse plus de mille créneaux.
 *
 * Réponse :
 *   { updated, backupsAssigned, unfilled, frozen, notifications }
 */
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  // SECURITY (audit du 19/08/2026, point #11) : opération lourde qui recalcule
  // tout le planning. Elle est légitimement déclenchée par un membre qui
  // enregistre ses disponibilités, mais un CANDIDAT n'a rien à y faire.
  if (payload.role !== "member") {
    return Response.json({ error: "Acces interdit" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));

    // Aperçu : réservé à l'admin, c'est lui qui arbitre un recalcul global.
    const dryRun = body.dryRun === true;
    if (dryRun && !payload.isAdmin) {
      return Response.json({ error: "Acces interdit" }, { status: 403 });
    }

    // Un recalcul lancé par l'admin fait le point sur TOUS les créneaux à
    // candidats en sous-effectif, pas seulement ceux qui viennent de basculer :
    // les cas installés ne basculent plus et ne seraient jamais signalés.
    const result = await runDispatch({
      epreuveId: body.epreuveId || undefined,
      dryRun,
      notifyAll: payload.isAdmin === true,
    });

    if (dryRun) {
      return Response.json({
        success: true,
        ...result,
        message:
          `Simulation : ${result.added?.length ?? 0} affectation(s) ajoutée(s), ` +
          `${result.removed?.length ?? 0} retirée(s), ` +
          `${result.understaffedWithCandidates?.length ?? 0} créneau(x) à candidats en sous-effectif. ` +
          "Rien n'a été enregistré.",
      });
    }

    return Response.json({
      success: true,
      ...result,
      message: `Dispatch terminé : ${result.updated} affectation(s), ${result.backupsAssigned} remplaçant(s), ${result.frozen} créneau(x) gelé(s), ${result.notifications} notification(s).`,
    });
  } catch (error) {
    console.error("dispatch/run error:", error);
    return Response.json(
      { error: "Le dispatch a échoué", details: String(error) },
      { status: 500 },
    );
  }
}
