import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { isMissingColumnError } from "@/lib/evaluation-access";
import { getAllExaminerCredits } from "@/lib/evaluation-examiners";
import { isLegacyCollectiveNote } from "@/lib/group-evaluation-criteria";
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
      // `is_group` + `is_group_epreuve` servent à écarter les anciennes notes
      // collectives des business games (cf. lib/group-evaluation-criteria).
      // `any` : le typage PostgREST annonce la jointure `epreuves` comme un
      // tableau, alors qu'une relation to-one renvoie bien un objet.
      fetchAllRows<any>((from, to) =>
        supabaseAdmin
          .from("candidate_evaluations")
          .select("id, member_id, is_group, epreuves(is_group_epreuve)")
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

    // Une note partagée (binôme / collective) est saisie par un seul membre
    // mais compte pour TOUS les examinateurs inscrits au créneau
    // (evaluator_tracking) — y compris celui qui ne s'est pas connecté. On
    // dédoublonne par paire (évaluation, membre) : l'auteur, déjà tracké,
    // ne doit pas être compté deux fois.
    const credits = await getAllExaminerCredits();
    const pairs = new Set<string>();
    // Évaluations qui décrivent un CANDIDAT. Les anciennes notes collectives
    // des business games (une ligne par candidat du groupe) en sont exclues :
    // elles gonflaient le compteur d'un examinateur — 2 candidats notés
    // s'affichaient « 4 évaluations ».
    const countableEvalIds = new Set<string>();
    let individualEvaluations = 0;
    if (perMemberRes.data) {
      for (const row of perMemberRes.data) {
        if (isLegacyCollectiveNote(row)) continue;
        individualEvaluations += 1;
        countableEvalIds.add(row.id);
        if (row.member_id) pairs.add(`${row.id}::${row.member_id}`);
      }
    }
    for (const c of credits) {
      // Ligne de suivi orpheline (évaluation supprimée hors application) ou
      // rattachée à une note collective : elle ne doit créditer personne.
      if (!countableEvalIds.has(c.evaluationId)) continue;
      pairs.add(`${c.evaluationId}::${c.memberId}`);
    }

    const evaluationsPerMember: Record<string, number> = {};
    Array.from(pairs).forEach((pair) => {
      const memberId = pair.split("::")[1];
      evaluationsPerMember[memberId] = (evaluationsPerMember[memberId] || 0) + 1;
    });

    // Noms des évaluateurs concernés : le graphe KPI affichait « Membre 1,
    // Membre 2… » (illisible pour arbitrer qui a noté). Page déjà admin-only,
    // et le tableau des évaluateurs nomme les mêmes personnes.
    const evaluatorIds = Object.keys(evaluationsPerMember);
    const membersById = new Map<
      string,
      { firstName: string; lastName: string; email: string; pole: string | null }
    >();
    if (evaluatorIds.length > 0) {
      const { data: memberRows } = await fetchAllRows<any>((from, to) =>
        supabaseAdmin
          .from("members")
          .select("id, email, first_name, last_name, pole")
          .in("id", evaluatorIds)
          .order("id")
          .range(from, to),
      );
      for (const m of memberRows || []) {
        membersById.set(m.id, {
          firstName: m.first_name || "",
          lastName: m.last_name || "",
          email: m.email,
          pole: m.pole ?? null,
        });
      }
    }

    const evaluationsPerMemberArray = Object.entries(evaluationsPerMember)
      .map(([memberId, count]) => ({
        memberId,
        _count: { id: count },
        member: membersById.get(memberId) ?? null,
      }))
      .sort(
        (a, b) =>
          b._count.id - a._count.id ||
          `${a.member?.lastName ?? ""}${a.member?.firstName ?? ""}`.localeCompare(
            `${b.member?.lastName ?? ""}${b.member?.firstName ?? ""}`,
          ),
      );

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
      // Évaluations de candidats : le décompte brut (`evaluationsRes`) inclut
      // les anciennes notes collectives, écartées ici comme ailleurs. Repli
      // sur lui si la lecture paginée a échoué.
      totalEvaluations:
        perMemberRes.data && perMemberRes.data.length > 0
          ? individualEvaluations
          : (evaluationsRes.count ?? 0),
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
