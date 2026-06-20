import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { isCandidateAdmittedTour1 } from "@/lib/admission";
import { getToursByNumber } from "@/lib/tour-status";
import { NextRequest } from "next/server";

/** Numéro du tour actuellement "en_cours" (0 si aucun). */
async function getActiveTourNumber(): Promise<number> {
  const map = await getToursByNumber();
  let active = 0;
  for (const [num, row] of Object.entries(map)) {
    if (row.status === "en_cours") active = Math.max(active, Number(num));
  }
  return active;
}

// SECURITY (audit #6/#7): only the candidate themselves OR a member
// (incl. admin) can read/write a candidate's wishes. Another candidate
// must NEVER be able to read or alter someone else's wishes.
function authorizeWishesAccess(
  payload: { role: string; id: string; isAdmin?: boolean },
  candidateId: string,
): boolean {
  if (payload.role === "candidate") {
    return payload.id === candidateId;
  }
  if (payload.role === "member") {
    return true; // members can view/edit candidate wishes (jury workflow)
  }
  return !!payload.isAdmin;
}

// GET /api/wishes/[candidateId] — get candidate wishes
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const { candidateId } = await params;
  if (!authorizeWishesAccess(payload as any, candidateId)) {
    return Response.json({ error: "Accès interdit" }, { status: 403 });
  }

  // ?tour=N — ne renvoyer que les vœux de ce tour. Si absent, renvoie tout
  // (rétro-compat). Le formulaire candidat passe le tour actif ; au tour 3,
  // si aucun vœu n'existe encore pour le tour 3, on retombe sur les vœux du
  // tour 2 pour pré-remplir le classement.
  const tourParam = req.nextUrl.searchParams.get("tour");
  const tour = tourParam ? parseInt(tourParam, 10) : null;

  try {
    let query = supabaseAdmin
      .from("candidate_wishes")
      .select("*")
      .eq("candidate_id", candidateId);
    if (tour) query = query.eq("tour", tour);

    const { data, error } = await query.order("rank", { ascending: true });
    if (error) throw error;

    // Repli tour 3 → tour 2 si rien n'a encore été saisi pour le tour 3.
    if (tour && tour >= 3 && (!data || data.length === 0)) {
      const { data: prev } = await supabaseAdmin
        .from("candidate_wishes")
        .select("*")
        .eq("candidate_id", candidateId)
        .eq("tour", 2)
        .order("rank", { ascending: true });
      return Response.json(prev || []);
    }

    return Response.json(data);
  } catch (error) {
    return Response.json({ error: "Failed to fetch wishes" }, { status: 500 });
  }
}

// PUT /api/wishes/[candidateId] — replace all wishes for a candidate
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const { candidateId } = await params;
  // SECURITY (audit #6): IDOR fix — block cross-candidate writes.
  if (!authorizeWishesAccess(payload as any, candidateId)) {
    return Response.json({ error: "Accès interdit" }, { status: 403 });
  }

  // TOUR 2 : un candidat ne peut classer ses vœux de pôles qu'une fois
  // admis au tour 2 (tour1_status = accepted). Membres/admin non concernés.
  if (payload.role === "candidate") {
    const admitted = await isCandidateAdmittedTour1(candidateId);
    if (!admitted) {
      return Response.json(
        {
          error:
            "Les choix de pôles sont débloqués uniquement pour les candidats admis au tour 2.",
        },
        { status: 403 },
      );
    }

    // VERROU DÉFINITIF (Tour 3) : une fois confirmés au tour 3, les vœux sont
    // figés. Un candidat ne peut plus les modifier (les membres/admin, eux,
    // gardent la main). Cf. supabase-migration-wishes-lock.sql.
    const { data: cand } = await supabaseAdmin
      .from("candidates")
      .select("wishes_locked_at")
      .eq("id", candidateId)
      .maybeSingle();
    if (cand?.wishes_locked_at) {
      return Response.json(
        {
          error:
            "Vos choix de pôles ont été confirmés définitivement et ne peuvent plus être modifiés.",
          locked: true,
        },
        { status: 403 },
      );
    }
  }

  try {
    const body = await req.json();
    const { wishes } = body;
    // Le client envoie definitive=true via le bouton « Confirmer mes choix
    // définitifs » (uniquement disponible au tour 3).
    const definitive = body?.definitive === true;

    if (!Array.isArray(wishes)) {
      return Response.json(
        { error: "wishes must be an array" },
        { status: 400 },
      );
    }

    // Tour auquel ces vœux sont rattachés : on horodate par tour pour
    // distinguer les choix PROVISOIRES (tour 2, dimensionnement du tour 3)
    // des choix DÉFINITIFS (tour 3). Dérivé côté serveur du tour en cours.
    const activeTour = await getActiveTourNumber();
    const wishTour = activeTour >= 3 ? 3 : 2;

    // Ne supprimer QUE les vœux du tour courant : les vœux du tour 2 doivent
    // persister quand le candidat enregistre ses vœux du tour 3.
    const { error: deleteError } = await supabaseAdmin
      .from("candidate_wishes")
      .delete()
      .eq("candidate_id", candidateId)
      .eq("tour", wishTour);

    if (deleteError) throw deleteError;

    // Insert new wishes
    if (wishes.length > 0) {
      const rows = wishes.map(
        (w: {
          pole: string;
          rank: number;
          wantsBureau?: boolean;
          posteDetail?: string | null;
        }) => ({
          candidate_id: candidateId,
          pole: w.pole,
          rank: w.rank,
          wants_bureau: !!w.wantsBureau,
          poste_detail: w.posteDetail || null,
          tour: wishTour,
        }),
      );

      const { error: insertError } = await supabaseAdmin
        .from("candidate_wishes")
        .insert(rows);

      if (insertError) throw insertError;
    }

    // VERROU : si c'est une confirmation définitive d'un candidat au tour 3,
    // on fige les vœux. On vérifie côté serveur que le tour actif est bien le
    // tour 3 (≥ 3) pour qu'un client ne puisse pas verrouiller prématurément.
    let locked = false;
    if (payload.role === "candidate" && definitive && activeTour >= 3) {
      await supabaseAdmin
        .from("candidates")
        .update({ wishes_locked_at: new Date().toISOString() })
        .eq("id", candidateId);
      locked = true;
    }

    // Return updated wishes
    const { data: updated, error: fetchError } = await supabaseAdmin
      .from("candidate_wishes")
      .select("*")
      .eq("candidate_id", candidateId)
      .order("rank", { ascending: true });

    if (fetchError) throw fetchError;

    return Response.json({ wishes: updated, locked });
  } catch (error) {
    return Response.json({ error: "Failed to save wishes" }, { status: 500 });
  }
}
