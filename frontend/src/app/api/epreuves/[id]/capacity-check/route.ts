import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { effectiveMaxCandidates } from "@/lib/enrollment";
import { NextRequest } from "next/server";

const DELIBERATION_FIELD: Record<number, string> = {
  2: "tour1_status",
  3: "tour2_status",
};

// GET /api/epreuves/[id]/capacity-check — admin : compare la capacité des
// créneaux correctement staffés (statut ready/published/full) au nombre de
// candidats attendus sur cette épreuve, pour alerter si ça ne suffira pas.
//
// Candidats attendus :
//   - Tour 1 : tous les candidats (filtrés par pôle si épreuve de pôle).
//   - Tour 2/3 : uniquement les candidats admis (délibération "accepted")
//     au tour précédent (filtrés par pôle si épreuve de pôle).
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  const { id } = params;

  try {
    const { data: epreuve, error: epErr } = await supabaseAdmin
      .from("epreuves")
      .select("id, tour, is_pole_test, pole, is_group_epreuve, group_size")
      .eq("id", id)
      .single();
    if (epErr || !epreuve) {
      return Response.json({ error: "Épreuve introuvable" }, { status: 404 });
    }

    // ── Candidats attendus ──────────────────────────────────────────
    let eligibleIds: Set<string> | null = null; // null = "tous"

    const prevField = DELIBERATION_FIELD[epreuve.tour];
    if (prevField) {
      const { data: rows } = await supabaseAdmin
        .from("deliberations")
        .select("candidate_id")
        .eq(prevField, "accepted");
      eligibleIds = new Set((rows || []).map((r: any) => r.candidate_id));
    }

    if (epreuve.is_pole_test && epreuve.pole) {
      const { data: wishRows } = await supabaseAdmin
        .from("candidate_wishes")
        .select("candidate_id")
        .eq("pole", epreuve.pole);
      const wished = new Set((wishRows || []).map((r: any) => r.candidate_id));
      eligibleIds = eligibleIds
        ? new Set(Array.from(eligibleIds).filter((cid) => wished.has(cid)))
        : wished;
    }

    let expectedCandidates: number;
    if (eligibleIds) {
      expectedCandidates = eligibleIds.size;
    } else {
      const { count } = await supabaseAdmin
        .from("candidates")
        .select("id", { count: "exact", head: true });
      expectedCandidates = count || 0;
    }

    // ── Capacité prête (créneaux correctement staffés) ──────────────
    const { data: slots, error: slotsErr } = await supabaseAdmin
      .from("evaluation_slots")
      .select("max_candidates, status")
      .eq("epreuve_id", id)
      .in("status", ["ready", "published", "full"]);
    if (slotsErr) throw slotsErr;

    const readyCapacity = (slots || []).reduce(
      (sum: number, s: any) =>
        sum + effectiveMaxCandidates({ max_candidates: s.max_candidates, epreuve }),
      0,
    );

    return Response.json({
      expectedCandidates,
      readyCapacity,
      sufficient: readyCapacity >= expectedCandidates,
      missing: Math.max(0, expectedCandidates - readyCapacity),
    });
  } catch (error) {
    console.error("Capacity check error:", error);
    return Response.json(
      { error: "Échec du calcul de capacité", details: (error as any)?.message || String(error) },
      { status: 500 },
    );
  }
}
