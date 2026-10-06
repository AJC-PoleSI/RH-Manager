import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import {
  effectiveCoefficient,
  getEpreuveCoefficient,
  getTotalMaxPoints,
  parseEpreuveCoefficient,
} from "@/lib/evaluation-criteria";
import { isMissingColumnError } from "@/lib/slot-lock";
import { getToursByNumber } from "@/lib/tour-status";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/** Borne haute d'un coefficient choisi : au-delà, c'est une faute de frappe. */
const MAX_COEFFICIENT = 100;

const MIGRATION_MESSAGE =
  "La colonne « coefficient » n'existe pas encore en base : migration à " +
  "appliquer (supabase-migration-coefficient-epreuve.sql). En attendant, " +
  "toutes les épreuves restent en coefficient automatique (barème ÷ 20).";

// PATCH /api/epreuves/[id]/coefficient — admin uniquement.
// Corps : { coefficient: number | null } — null = automatique (barème ÷ 20).
//
// Route dédiée plutôt que le PUT /api/epreuves/[id] (07/10/2026) : le
// coefficient change les MOYENNES des candidats, il a donc sa propre règle de
// verrouillage — refus si le tour de l'épreuve est terminé. C'est ce qui
// protège les moyennes déjà délibérées des tours 1 et 2 : on ne peut ni
// poser ni retirer un coefficient sur leurs épreuves tant que le tour n'a pas
// été réouvert.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin || user.role === "candidate") return forbidden();

  const { id } = params;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Corps de requête invalide." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !("coefficient" in body)) {
    return Response.json(
      { error: "Champ « coefficient » manquant (nombre, ou null pour automatique)." },
      { status: 400 },
    );
  }

  // null = retour à l'automatique ; sinon un vrai nombre, fini, dans ]0 ; 100].
  const raw = body.coefficient;
  let coefficient: number | null;
  if (raw === null) {
    coefficient = null;
  } else if (
    typeof raw === "number" &&
    Number.isFinite(raw) &&
    raw > 0 &&
    raw <= MAX_COEFFICIENT
  ) {
    coefficient = raw;
  } else {
    return Response.json(
      {
        error: `Coefficient invalide : saisir un nombre strictement positif, au plus ${MAX_COEFFICIENT} (ou laisser vide pour le calcul automatique).`,
      },
      { status: 400 },
    );
  }

  try {
    const { data: epreuve, error: fetchError } = await supabaseAdmin
      .from("epreuves")
      .select("id, name, tour, evaluation_questions")
      .eq("id", id)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!epreuve) {
      return Response.json({ error: "Épreuve introuvable." }, { status: 404 });
    }

    // Verrou des tours terminés. getToursByNumber rend {} en cas d'erreur de
    // lecture : dans le doute, on refuse plutôt que de risquer de modifier
    // une moyenne délibérée.
    const tours = await getToursByNumber();
    if (Object.keys(tours).length === 0) {
      return Response.json(
        {
          error:
            "Impossible de vérifier le statut des tours : coefficient non modifié. Réessayez dans un instant.",
        },
        { status: 503 },
      );
    }
    if (tours[epreuve.tour]?.status === "termine") {
      return Response.json(
        {
          error: `Le Tour ${epreuve.tour} est terminé : le coefficient de « ${epreuve.name} » est figé pour ne pas modifier les moyennes déjà délibérées. Réouvrez le tour pour le changer.`,
        },
        { status: 409 },
      );
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("epreuves")
      .update({ coefficient })
      .eq("id", id)
      .select("id, name, tour, evaluation_questions, coefficient")
      .single();

    if (updateError) {
      if (isMissingColumnError(updateError)) {
        return Response.json({ error: MIGRATION_MESSAGE }, { status: 409 });
      }
      throw updateError;
    }

    const maxTotal = getTotalMaxPoints(updated.evaluation_questions);
    const chosen = parseEpreuveCoefficient(updated.coefficient);
    return Response.json({
      id: updated.id,
      name: updated.name,
      tour: updated.tour,
      coefficient: chosen,
      maxTotal,
      // Poids automatique (barème ÷ 20) et poids réellement utilisé dans les
      // moyennes, pour que l'écran affiche l'effet sans recalcul.
      autoCoefficient: getEpreuveCoefficient(maxTotal),
      effectiveCoefficient: effectiveCoefficient(chosen, maxTotal),
    });
  } catch (error) {
    console.error("PATCH /epreuves/[id]/coefficient error:", error);
    return Response.json(
      { error: "Échec de l'enregistrement du coefficient." },
      { status: 500 },
    );
  }
}
