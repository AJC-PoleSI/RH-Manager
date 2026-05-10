import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";

// GET /api/deliberations - Fetch all deliberations with candidate info
// SECURITY: Requires authentication + admin/member role (no candidates)
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (payload.role === "candidate") return forbidden();

  try {
    const { searchParams } = new URL(req.url);
    const tour = searchParams.get("tour");

    const { data: candidates, error } = await supabaseAdmin
      .from("candidates")
      .select(
        `
        id,
        first_name,
        last_name,
        email,
        phone,
        comments,
        formation,
        deliberations(*),
        candidate_evaluations(
          id,
          scores,
          comment,
          member_id,
          created_at,
          members(email, first_name, last_name),
          epreuves(id, name, tour, type)
        ),
        candidate_wishes(
          id,
          pole,
          rank
        )
      `,
      )
      .order("last_name", { ascending: true });

    if (error) throw error;

    const result = (candidates || []).map((c) => {
      let evaluations: any[] = c.candidate_evaluations || [];

      if (tour) {
        const tourNum = parseInt(tour);
        evaluations = evaluations.filter(
          (ev: any) => ev.epreuves?.tour === tourNum,
        );
      }

      evaluations = evaluations.map((ev: any) => ({
        id: ev.id,
        scores:
          typeof ev.scores === "string" ? JSON.parse(ev.scores) : ev.scores,
        comment: ev.comment,
        createdAt: ev.created_at,
        member: ev.members
          ? {
              email: ev.members.email,
              firstName: ev.members.first_name,
              lastName: ev.members.last_name,
            }
          : null,
        epreuve: ev.epreuves
          ? {
              name: ev.epreuves.name,
              tour: ev.epreuves.tour,
              type: ev.epreuves.type,
            }
          : null,
      }));

      const wishes = (c.candidate_wishes || [])
        .sort((a: any, b: any) => (a.rank || 99) - (b.rank || 99))
        .map((w: any) => ({
          pole: w.pole,
          rank: w.rank,
        }));

      const delib = Array.isArray(c.deliberations)
        ? c.deliberations[0] || null
        : c.deliberations;

      return {
        id: c.id,
        firstName: c.first_name,
        lastName: c.last_name,
        email: c.email,
        phone: c.phone,
        formation: c.formation,
        comments: c.comments,
        deliberation: delib
          ? {
              tour1Status: delib.tour1_status,
              tour2Status: delib.tour2_status,
              tour3Status: delib.tour3_status,
              prosComment: delib.pros_comment,
              consComment: delib.cons_comment,
              assignedPole: delib.assigned_pole,
            }
          : null,
        wishes,
        evaluations,
      };
    });

    return Response.json(result);
  } catch (error) {
    console.error("getAllDeliberations error:", error);
    return Response.json(
      { error: "Failed to fetch deliberation data" },
      { status: 500 },
    );
  }
}
