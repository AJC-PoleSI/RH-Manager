import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { filterActiveEnrollments } from "@/lib/enrollment";
import { fetchAllRows } from "@/lib/supabase-paging";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/** Jamais plus : ce point d'entrée sert à CHERCHER, pas à énumérer. */
const MAX_RESULTS = 12;
/** En dessous, une recherche ramènerait un échantillon arbitraire. */
const MIN_QUERY = 2;

// GET /api/candidates/search?q=...&creneauId=...
//
// Recherche nominative d'un candidat, pensée pour un sélecteur : sans `q`,
// AUCUN résultat — la liste complète des candidats n'a rien à faire dans un
// champ de recherche, et la charger à chaque ouverture coûte cher (plus de
// 300 candidats en prod) pour une saisie qui vise une personne précise.
//
// `creneauId` (facultatif) enrichit chaque résultat de la position ACTUELLE du
// candidat sur l'épreuve de ce créneau : sans elle, l'admin déplace à
// l'aveugle et ne sait pas ce qu'il défait.
//
// Le paramètre s'appelle `creneauId` et non `slotId` par cohérence avec le
// nommage FR adopté depuis l'incident bloqueur de pub sur /api/kpis/slots.
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  // Identité + email + emploi du temps d'un candidat : réservé aux admins.
  if (payload.role === "candidate" || !payload.isAdmin) return forbidden();

  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("q") || "").trim();
  const creneauId = searchParams.get("creneauId");

  if (raw.length < MIN_QUERY) return Response.json({ data: [] });

  // SECURITY (même règle que GET /api/candidates) : `q` est injecté dans un
  // filtre PostgREST `.or()`. On retire ses caractères de contrôle pour
  // empêcher l'injection de filtres arbitraires.
  const tokens = raw
    .split(/\s+/)
    .map((t) => t.replace(/[(),*%]/g, "").trim())
    .filter(Boolean);
  if (tokens.length === 0) return Response.json({ data: [] });

  try {
    // Un `.or()` par mot saisi, et les `.or()` successifs se combinent en ET :
    // « jean dupont » exige que « jean » ET « dupont » matchent chacun un
    // champ, sinon seul le prénom serait pris en compte.
    let query = supabaseAdmin
      .from("candidates")
      .select("id, first_name, last_name, email")
      .order("last_name", { ascending: true })
      .limit(MAX_RESULTS);

    for (const token of tokens) {
      query = query.or(
        ["first_name", "last_name", "email"]
          .map((f) => `${f}.ilike.%${token}%`)
          .join(","),
      );
    }

    const { data: candidates, error } = await query;
    if (error) throw error;

    const results = (candidates || []).map((c: any) => ({
      id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      email: c.email,
      current: null as null | Record<string, unknown>,
      here: false,
    }));

    if (!creneauId || results.length === 0) {
      return Response.json({ data: results });
    }

    // ── Où en est chaque candidat sur CETTE épreuve ? ──
    const { data: target } = await supabaseAdmin
      .from("evaluation_slots")
      .select("id, epreuve_id")
      .eq("id", creneauId)
      .maybeSingle();

    if (!target?.epreuve_id) return Response.json({ data: results });

    // Lecture paginée : PostgREST tronque à 1000 lignes sans le dire.
    const { data: epreuveSlots } = await fetchAllRows<any>((from, to) =>
      supabaseAdmin
        .from("evaluation_slots")
        .select("id, date, start_time, end_time, room")
        .eq("epreuve_id", target.epreuve_id)
        .order("id", { ascending: true })
        .range(from, to),
    );

    const slotById = new Map<string, any>(
      (epreuveSlots || []).map((s: any) => [s.id, s]),
    );
    if (slotById.size === 0) return Response.json({ data: results });

    // Filtre par CANDIDAT seulement (12 au plus), le rattachement à l'épreuve
    // se fait en mémoire : une épreuve peut porter des centaines de créneaux,
    // et un `.in("slot_id", …)` de cette taille ferait exploser l'URL
    // PostgREST.
    const { data: enrollments } = await supabaseAdmin
      .from("slot_enrollments")
      .select("candidate_id, slot_id, status")
      .in(
        "candidate_id",
        results.map((r) => r.id),
      );

    for (const e of (enrollments || []).filter(filterActiveEnrollments)) {
      const row = results.find((r) => r.id === e.candidate_id);
      const slot = slotById.get(e.slot_id);
      if (!row || !slot) continue;
      row.current = slot;
      row.here = slot.id === creneauId;
    }

    return Response.json({ data: results });
  } catch (e) {
    console.error("Recherche candidats:", e);
    return Response.json(
      { error: "Recherche impossible" },
      { status: 500 },
    );
  }
}
