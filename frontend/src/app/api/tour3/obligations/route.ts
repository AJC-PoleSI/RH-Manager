import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { NextRequest } from "next/server";

// GET /api/tour3/obligations — Demandes de pôle (Tour 3) par pôle.
// Pour chaque pôle : combien de candidats ADMIS au tour 2 ont demandé ce
// pôle dans leurs vœux, dont combien ont coché l'option "bureau" (Dev Co
// / Audit Qualité), combien de membres sont dans ce pôle, et une
// estimation du nombre de créneaux à prévoir par membre.
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  try {
    // 1. Candidats admis au tour 2 (= ceux qui passeront le tour 3)
    const { data: delibs, error: delibErr } = await supabaseAdmin
      .from("deliberations")
      .select("candidate_id")
      .eq("tour2_status", "accepted");
    if (delibErr) throw delibErr;

    const acceptedTour2 = new Set(
      (delibs || []).map((d: any) => d.candidate_id),
    );

    // 2. Vœux de pôle de ces candidats
    const { data: wishes, error: wishErr } = await supabaseAdmin
      .from("candidate_wishes")
      .select("pole, candidate_id, wants_bureau");
    if (wishErr) throw wishErr;

    const candidatsParPole: Record<string, Set<string>> = {};
    const bureauParPole: Record<string, Set<string>> = {};
    (wishes || []).forEach((w: any) => {
      if (!acceptedTour2.has(w.candidate_id)) return;
      if (!candidatsParPole[w.pole]) candidatsParPole[w.pole] = new Set();
      candidatsParPole[w.pole].add(w.candidate_id);
      if (w.wants_bureau) {
        if (!bureauParPole[w.pole]) bureauParPole[w.pole] = new Set();
        bureauParPole[w.pole].add(w.candidate_id);
      }
    });

    // 3. Membres par pôle
    const { data: members, error: memErr } = await supabaseAdmin
      .from("members")
      .select("id, email, first_name, last_name, pole, is_admin")
      .eq("is_admin", false);
    if (memErr) throw memErr;

    const membresParPole: Record<string, number> = {};
    (members || []).forEach((m: any) => {
      if (!m.pole) return;
      membresParPole[m.pole] = (membresParPole[m.pole] || 0) + 1;
    });

    // 4. Construire le résultat
    const allPoles = new Set([
      ...Object.keys(candidatsParPole),
      ...Object.keys(membresParPole),
    ]);

    const obligations = Array.from(allPoles)
      .map((pole) => {
        const candidatsCount = candidatsParPole[pole]?.size || 0;
        const bureauCount = bureauParPole[pole]?.size || 0;
        const membresCount = membresParPole[pole] || 0;
        // Estimation : créneaux par membre (réparti équitablement, arrondi au supérieur)
        const creneauxParMembre =
          membresCount > 0 ? Math.ceil(candidatsCount / membresCount) : candidatsCount;

        return {
          pole,
          candidatsCount,
          bureauCount,
          membresCount,
          creneauxParMembre,
        };
      })
      .sort((a, b) => b.candidatsCount - a.candidatsCount);

    // 5. Si le caller est un membre non-admin, ajouter son obligation perso
    let myObligation = null;
    if (payload.role === "member" && !payload.isAdmin) {
      const me = (members || []).find((m: any) => m.id === payload.id);
      if (me?.pole) {
        const poleData = obligations.find((o) => o.pole === me.pole);
        if (poleData) {
          myObligation = {
            pole: me.pole,
            creneauxRequis: poleData.candidatsCount,
            creneauxParMembre: poleData.creneauxParMembre,
            membresCount: poleData.membresCount,
            candidatsCount: poleData.candidatsCount,
          };
        }
      }
    }

    return Response.json({ obligations, myObligation });
  } catch (error) {
    console.error("GET tour3/obligations error:", error);
    return Response.json({ error: "Failed to fetch obligations" }, { status: 500 });
  }
}
