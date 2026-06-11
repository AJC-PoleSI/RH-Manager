import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { NextRequest } from "next/server";

// GET /api/tour3/obligations — Calcule les obligations Tour 3 par pôle
// Pour chaque pôle : combien de candidats ont demandé ce pôle,
// combien de membres sont dans ce pôle, combien de créneaux sont nécessaires
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  try {
    // 1. Compter les demandes par pôle (via candidate_wishes)
    const { data: wishes, error: wishErr } = await supabaseAdmin
      .from("candidate_wishes")
      .select("pole, candidate_id");
    if (wishErr) throw wishErr;

    const demandesParPole: Record<string, number> = {};
    (wishes || []).forEach((w: any) => {
      // Compter les candidats DISTINCTS par pôle
      demandesParPole[w.pole] = (demandesParPole[w.pole] || 0) + 1;
    });

    // Dédupliquer : compter les candidats distincts par pôle
    const candidatsParPole: Record<string, Set<string>> = {};
    (wishes || []).forEach((w: any) => {
      if (!candidatsParPole[w.pole]) candidatsParPole[w.pole] = new Set();
      candidatsParPole[w.pole].add(w.candidate_id);
    });

    // 2. Compter les membres par pôle
    const { data: members, error: memErr } = await supabaseAdmin
      .from("members")
      .select("id, email, first_name, last_name, pole, is_admin")
      .eq("is_admin", false);
    if (memErr) throw memErr;

    const membresParPole: Record<string, { id: string; email: string; firstName: string; lastName: string }[]> = {};
    (members || []).forEach((m: any) => {
      if (!m.pole) return;
      if (!membresParPole[m.pole]) membresParPole[m.pole] = [];
      membresParPole[m.pole].push({
        id: m.id,
        email: m.email,
        firstName: m.first_name || "",
        lastName: m.last_name || "",
      });
    });

    // 2bis. Progression réelle : créneaux d'épreuves de pôle existants et
    // assignations examinateurs (combien de créneaux chaque membre couvre).
    const { data: poleSlots } = await supabaseAdmin
      .from("evaluation_slots")
      .select(
        "id, status, epreuve:epreuves!inner(is_pole_test, pole), assignments:slot_member_assignments(member_id)",
      )
      .eq("epreuve.is_pole_test", true);

    const slotsParPole: Record<string, number> = {};
    const assignesParPoleMembre: Record<string, Record<string, number>> = {};
    for (const s of (poleSlots as any[]) || []) {
      const pole = s.epreuve?.pole;
      if (!pole) continue;
      slotsParPole[pole] = (slotsParPole[pole] || 0) + 1;
      for (const a of s.assignments || []) {
        if (!assignesParPoleMembre[pole]) assignesParPoleMembre[pole] = {};
        assignesParPoleMembre[pole][a.member_id] =
          (assignesParPoleMembre[pole][a.member_id] || 0) + 1;
      }
    }

    // 3. Construire le résultat
    const allPoles = new Set([
      ...Object.keys(candidatsParPole),
      ...Object.keys(membresParPole),
    ]);

    const obligations = Array.from(allPoles).map((pole) => {
      const candidatsCount = candidatsParPole[pole]?.size || 0;
      const membres = membresParPole[pole] || [];
      const membresCount = membres.length;
      // Nombre minimum de créneaux requis = nombre de candidats demandant ce pôle
      const creneauxRequis = candidatsCount;
      // Créneaux par membre (réparti équitablement, arrondi au supérieur)
      const creneauxParMembre = membresCount > 0 ? Math.ceil(creneauxRequis / membresCount) : creneauxRequis;

      return {
        pole,
        candidatsCount,
        membresCount,
        membres: membres.map(m => ({
          id: m.id,
          email: m.email,
          firstName: m.firstName,
          lastName: m.lastName,
          creneauxAssignes: assignesParPoleMembre[pole]?.[m.id] || 0,
        })),
        creneauxRequis,
        creneauxParMembre,
        creneauxOuverts: slotsParPole[pole] || 0,
      };
    }).sort((a, b) => b.candidatsCount - a.candidatsCount);

    // 4. Si le caller est un membre non-admin, ajouter son obligation perso
    let myObligation = null;
    if (payload.role === "member" && !payload.isAdmin) {
      const me = (members || []).find((m: any) => m.id === payload.id);
      if (me?.pole) {
        const poleData = obligations.find(o => o.pole === me.pole);
        if (poleData) {
          myObligation = {
            pole: me.pole,
            creneauxRequis: poleData.creneauxRequis,
            creneauxParMembre: poleData.creneauxParMembre,
            membresCount: poleData.membresCount,
            candidatsCount: poleData.candidatsCount,
            mesCreneaux: assignesParPoleMembre[me.pole]?.[payload.id] || 0,
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
