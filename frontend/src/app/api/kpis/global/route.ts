import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { isMissingColumnError } from "@/lib/evaluation-access";
import { fetchAllRows } from "@/lib/supabase-paging";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/kpis/global - Fetch global KPIs with real data
//
// SECURITY : réservé aux admins. Ce sont des chiffres de PILOTAGE du
// recrutement, pas un outil de jury — et `evaluationsPerMember` expose
// nommément combien d'évaluations chaque examinateur a saisies. Les deux
// écrans voisins (KPI par pôle, suivi des évaluateurs) étaient déjà
// admin-only ; celui-ci restait ouvert à tout membre.
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const [
      candidatesRes,
      evaluationsRes,
      epreuvesRes,
      membersRes,
      perMemberRes,
      slotsRes,
      deliberationsRes,
      toursRes,
      availabilitiesCountRes,
    ] = await Promise.all([
      // Même périmètre que la soirée de délibération et l'export : un
      // candidat dont l'email n'est pas vérifié n'a pas fini son inscription
      // et n'aura jamais de statut — il ne doit pas gonfler « En cours ».
      supabaseAdmin
        .from("candidates")
        .select("id", { count: "exact", head: true })
        .eq("email_verified", true),
      supabaseAdmin
        .from("candidate_evaluations")
        .select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("epreuves")
        .select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("members")
        .select("id", { count: "exact", head: true }),
      // Paginé : le total d'évaluations dépassera 1000 au fil des tours.
      fetchAllRows<{ member_id: string }>((from, to) =>
        supabaseAdmin
          .from("candidate_evaluations")
          .select("member_id")
          .order("id")
          .range(from, to),
      ),
      // Only count slots linked to a real épreuve — orphan slots (epreuve_id=null)
      // are bugs/leftovers and must NOT inflate the "Créneaux planifiés" KPI.
      supabaseAdmin
        .from("evaluation_slots")
        .select("id", { count: "exact", head: true })
        .not("epreuve_id", "is", null),
      supabaseAdmin.from("deliberations").select("*"),
      // « Tours créés » = la table `tours`, pas les valeurs distinctes de
      // `epreuves.tour` (3 tours créés sans épreuve au tour 2 affichait 1).
      supabaseAdmin.from("tours").select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("availabilities")
        .select("id", { count: "exact", head: true }),
    ]);

    const evaluationsPerMember: Record<string, number> = {};
    if (perMemberRes.data) {
      for (const row of perMemberRes.data) {
        evaluationsPerMember[row.member_id] =
          (evaluationsPerMember[row.member_id] || 0) + 1;
      }
    }

    const evaluationsPerMemberArray = Object.entries(evaluationsPerMember)
      .map(([memberId, count]) => ({ memberId, _count: { id: count } }))
      .sort((a, b) => b._count.id - a._count.id);

    const toursCreated = toursRes.count ?? 0;

    // Colonne `email_verified` absente (migration pas appliquée) : on retombe
    // sur le décompte brut plutôt que de casser tout le tableau de bord.
    let totalCandidates = candidatesRes.count ?? 0;
    if (candidatesRes.error && isMissingColumnError(candidatesRes.error)) {
      const { count } = await supabaseAdmin
        .from("candidates")
        .select("id", { count: "exact", head: true });
      totalCandidates = count ?? 0;
    }
    const deliberations = deliberationsRes.data || [];

    let accepted = 0;
    let refused = 0;
    let waiting = 0;

    deliberations.forEach((d: any) => {
      const statuses = [d.tour3_status, d.tour2_status, d.tour1_status];
      for (const s of statuses) {
        if (s && s !== "pending") {
          if (s === "accepted") accepted++;
          else if (s === "refused") refused++;
          else if (s === "waiting") waiting++;
          break;
        }
      }
    });

    const enCours = totalCandidates - accepted - refused - waiting;

    return Response.json({
      totalCandidates,
      totalEvaluations: evaluationsRes.count ?? 0,
      totalEpreuves: epreuvesRes.count ?? 0,
      totalMembers: membersRes.count ?? 0,
      totalSlots: slotsRes.count ?? 0,
      totalAvailabilities: availabilitiesCountRes.count ?? 0,
      toursCreated,
      evaluationsPerMember: evaluationsPerMemberArray,
      enCours: Math.max(enCours, 0),
      accepted,
      refused,
      waiting,
    });
  } catch (error) {
    console.error("KPI Error:", error);
    return Response.json({ error: "Failed to fetch KPIs" }, { status: 500 });
  }
}
