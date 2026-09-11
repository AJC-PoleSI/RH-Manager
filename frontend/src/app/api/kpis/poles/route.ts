import { supabaseAdmin } from "@/lib/supabase";
import { latestTourWishesByCandidate } from "@/lib/wishes";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { fetchAllRows } from "@/lib/supabase-paging";
import { NextRequest } from "next/server";

// GET /api/kpis/poles — KPI des voeux de pôles pour la Soirée Délibération
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  // SECURITY (audit #12): candidates must not read pole stats with
  // candidate names attached — internal KPI for staff only.
  if (payload.role === "candidate") return forbidden();

  try {
    // Fetch all wishes — paginé : 3 vœux × 2 tours × N candidats dépasse
    // vite le plafond PostgREST de 1000 lignes.
    const { data: wishes, error: wishError } = await fetchAllRows<any>(
      (from, to) =>
        supabaseAdmin
          .from("candidate_wishes")
          .select("*, candidate:candidates(id, first_name, last_name)")
          .order("id")
          .range(from, to),
    );

    if (wishError) throw wishError;

    // ────────────────────────────────────────────────────────────────────
    // Un candidat a DEUX jeux de vœux : provisoires (tour 2) et définitifs
    // (tour 3), depuis `supabase-migration-wishes-tour.sql`. L'agrégation ne
    // filtrait pas sur `tour` (audit du 07/09/2026) : un candidat qui
    // confirmait le même pôle au tour 3 était compté DEUX fois dans
    // totalDemandes et dans son rang — les chiffres de la Soirée
    // Délibération étaient donc gonflés.
    //
    // On ne garde que le tour le plus avancé de CHAQUE candidat : ses choix
    // définitifs s'ils existent, sinon ses choix provisoires. Si la colonne
    // `tour` n'est pas encore posée, toutes les lignes retombent sur 0 et le
    // comportement reste celui d'avant (aucune ligne perdue).
    // ────────────────────────────────────────────────────────────────────
    const currentWishes = latestTourWishesByCandidate(wishes as any[]);

    // Fetch accepted deliberations (pour compter les places acceptées).
    //
    // `assigned_pole` n'existe pas encore sur toutes les bases : la colonne
    // n'a longtemps été créée par aucune migration versionnée, et son absence
    // faisait échouer TOUTE la route en 500 (code Postgres 42703) — l'écran
    // « KPI par pôle » était donc inutilisable. On la lit à part et on se
    // rabat sur un décompte vide si elle manque, plutôt que de perdre aussi
    // les statistiques de vœux, qui ne dépendent pas d'elle.
    const { data: deliberations, error: delibError } = await supabaseAdmin
      .from("deliberations")
      .select("candidate_id, tour1_status, tour2_status, tour3_status");

    if (delibError) throw delibError;

    const { data: assignedRows, error: assignedError } = await supabaseAdmin
      .from("deliberations")
      .select("candidate_id, assigned_pole");

    if (assignedError && assignedError.code !== "42703") throw assignedError;
    const assignments = assignedError ? [] : (assignedRows ?? []);

    // Agréger par pôle
    const poleStats: Record<
      string,
      {
        pole: string;
        totalDemandes: number; // Nombre total de voeux pour ce pôle (tous rangs)
        demandesRang1: number; // Voeux en rang 1 (premier choix)
        demandesRang2: number; // Voeux en rang 2
        demandesRang3: number; // Voeux en rang 3
        placesAcceptees: number; // Candidats assignés à ce pôle (acceptés)
      }
    > = {};

    // Compter les demandes par pôle et rang
    currentWishes.forEach((w: any) => {
      const pole = w.pole || "Non défini";
      if (!poleStats[pole]) {
        poleStats[pole] = {
          pole,
          totalDemandes: 0,
          demandesRang1: 0,
          demandesRang2: 0,
          demandesRang3: 0,
          placesAcceptees: 0,
        };
      }
      poleStats[pole].totalDemandes++;
      if (w.rank === 1) poleStats[pole].demandesRang1++;
      else if (w.rank === 2) poleStats[pole].demandesRang2++;
      else if (w.rank === 3) poleStats[pole].demandesRang3++;
    });

    // Compter les places acceptées par pôle.
    //
    // `assigned_pole` n'est écrit par aucune route aujourd'hui (audit du
    // 12/09/2026) : la colonne « Acceptés » restait à 0 en soirée de
    // délibération. On compte donc les candidats ADMIS AU TOUR 3 (décision
    // finale), rattachés à leur pôle affecté s'il est renseigné, sinon à leur
    // premier vœu du tour le plus avancé.
    const assignedByCandidate = new Map<string, string>();
    assignments.forEach((d: any) => {
      if (d.candidate_id && d.assigned_pole)
        assignedByCandidate.set(d.candidate_id, d.assigned_pole);
    });
    const firstWishByCandidate = new Map<string, string>();
    currentWishes.forEach((w: any) => {
      if (w.candidate_id && w.rank === 1 && w.pole)
        firstWishByCandidate.set(w.candidate_id, w.pole);
    });
    (deliberations || []).forEach((d: any) => {
      if (d.tour3_status !== "accepted") return;
      const pole =
        assignedByCandidate.get(d.candidate_id) ||
        firstWishByCandidate.get(d.candidate_id);
      if (pole && poleStats[pole]) poleStats[pole].placesAcceptees++;
    });

    // Trier par nombre total de demandes (desc)
    const result = Object.values(poleStats).sort(
      (a, b) => b.totalDemandes - a.totalDemandes,
    );

    return Response.json({
      poles: result,
      totalWishes: currentWishes.length,
      totalCandidatesWithWishes: new Set(
        currentWishes.map((w: any) => w.candidate_id),
      ).size,
    });
  } catch (error) {
    console.error("KPI poles error:", error);
    return Response.json(
      { error: "Failed to fetch pole KPIs" },
      { status: 500 },
    );
  }
}
