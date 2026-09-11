import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import {
  filterActiveEnrollments,
  effectiveMaxCandidates,
} from "@/lib/enrollment";
import { fetchAllRows } from "@/lib/supabase-paging";
import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";

// GET /api/slots/all — get all slots with members & enrollments (with optional filters)
//
// SECURITY : réservé au staff. Cette route renvoie le planning COMPLET, avec
// pour chaque créneau l'identité des examinateurs affectés ET celle des
// candidats inscrits (nom, prénom, email). Elle ne vérifiait auparavant que la
// présence d'un jeton : n'importe quel candidat pouvait donc énumérer tous les
// autres candidats du recrutement et connaître à l'avance la composition de
// son jury.
//
// Côté candidat, les écrans utilisent /api/slots/available et
// /api/slots/my-enrollments, qui filtrent correctement.
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (payload.role === "candidate") return forbidden();

  const { searchParams } = new URL(req.url);
  const tour = searchParams.get("tour");
  const status = searchParams.get("status");
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  try {
    // Lecture PAGINÉE : la prod dépasse 1000 créneaux (1076 au 12/09/2026)
    // et PostgREST tronque silencieusement toute lecture non paginée à 1000
    // lignes — le planning admin perdait 76 créneaux sans aucune erreur.
    // `.order("id")` en dernier garantit un parcours stable entre les pages.
    const buildQuery = () => {
      let query = supabaseAdmin
        .from("evaluation_slots")
        .select(
          `
        *,
        epreuve:epreuves(id, name, tour, type, is_group_epreuve, group_size),
        members:slot_member_assignments(*, member:members(id, email, first_name, last_name)),
        enrollments:slot_enrollments(*, candidate:candidates(id, first_name, last_name, email)),
        requests:slot_availability_requests(*, member:members(id, email))
      `,
        )
        .order("date", { ascending: true })
        .order("start_time", { ascending: true })
        .order("id", { ascending: true });

      if (tour) query = query.eq("tour", parseInt(tour));
      if (status) query = query.eq("status", status);
      if (start && end) {
        const startDate = new Date(start);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(end);
        endDate.setHours(23, 59, 59, 999);
        query = query
          .gte("date", startDate.toISOString())
          .lte("date", endDate.toISOString());
      }
      return query;
    };

    const { data, error } = await fetchAllRows<any>((from, to) =>
      buildQuery().range(from, to),
    );
    if (error) throw error;
    // FIX C2 + H5: drop slots without épreuve (orphan guard), and also
    // strip cancelled enrollments from each slot so capacity / candidate
    // lists across admin/member views are consistent.
    const validData = (data || [])
      .filter((slot: any) => slot.epreuve)
      .map((slot: any) => ({
        ...slot,
        // Capacité effective (group_size pour les épreuves de groupe) pour
        // que le planning admin/membre affiche la même limite que le candidat.
        max_candidates: effectiveMaxCandidates(slot),
        enrollments: (slot.enrollments || []).filter(
          filterActiveEnrollments,
        ),
      }));
    // FIX C4: explicit no-store — admin /planning was previously serving
    // stale lists because the client didn't pass cache-busting params.
    return new Response(JSON.stringify(validData), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    return Response.json({ error: "Failed to fetch slots" }, { status: 500 });
  }
}
