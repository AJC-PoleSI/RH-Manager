import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { getTotalMaxPoints } from "@/lib/evaluation-criteria";
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

    const canSeeAllComments = payload.isAdmin;

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
          members!member_id(email, first_name, last_name),
          epreuves(id, name, tour, type, evaluation_questions)
        ),
        candidate_wishes(
          id,
          pole,
          rank,
          wants_bureau,
          poste_detail
        )
      `,
      )
      // SECURITY: hide candidates whose email is not yet verified — they
      // haven't completed the inscription flow, so they shouldn't surface
      // in the deliberation soirée.
      .eq("email_verified", true)
      .order("last_name", { ascending: true });

    if (error) throw error;

    // ── Trombinoscope : photo + coups de cœur ────────────────────────────
    // Deux lectures séparées plutôt qu'une jointure : la photo pèse plusieurs
    // dizaines de kilo-octets, elle ne doit JAMAIS voyager dans cette réponse
    // (le client la récupère une par une sur /api/candidates/[id]/photo). On
    // ne remonte ici que l'existence de la photo et sa date.
    const [photosRes, favoritesRes] = await Promise.all([
      supabaseAdmin.from("candidate_photos").select("candidate_id, updated_at"),
      // SECURITY : un examinateur non-admin ne voit QUE ses propres coups de
      // cœur. Le décompte global et le nom des votants sont réservés à l'admin.
      canSeeAllComments
        ? supabaseAdmin
            .from("candidate_favorites")
            .select(
              "candidate_id, member_id, members!member_id(first_name, last_name, email)",
            )
        : supabaseAdmin
            .from("candidate_favorites")
            .select("candidate_id, member_id")
            .eq("member_id", payload.id),
    ]);

    const photoByCandidate = new Map<string, string>();
    if (!photosRes.error) {
      for (const p of photosRes.data || []) {
        photoByCandidate.set(p.candidate_id, p.updated_at);
      }
    } else {
      // Table absente (migration non appliquée) : la délibération doit
      // continuer de fonctionner, simplement sans photos.
      console.error("deliberations: candidate_photos indisponible", photosRes.error);
    }

    const myFavorites = new Set<string>();
    const favoritesByCandidate = new Map<string, string[]>();
    if (!favoritesRes.error) {
      for (const f of (favoritesRes.data || []) as any[]) {
        if (f.member_id === payload.id) myFavorites.add(f.candidate_id);
        if (canSeeAllComments) {
          const m = f.members;
          const name = m
            ? [m.first_name, m.last_name].filter(Boolean).join(" ").trim() ||
              m.email
            : "Membre";
          const list = favoritesByCandidate.get(f.candidate_id) || [];
          list.push(name);
          favoritesByCandidate.set(f.candidate_id, list);
        }
      }
    } else {
      console.error(
        "deliberations: candidate_favorites indisponible",
        favoritesRes.error,
      );
    }

    const result = (candidates || []).map((c) => {
      let evaluations: any[] = c.candidate_evaluations || [];

      if (tour) {
        const tourNum = parseInt(tour);
        evaluations = evaluations.filter(
          (ev: any) => ev.epreuves?.tour === tourNum,
        );
      }

      evaluations = evaluations.map((ev: any) => {
        const isOwnEval = ev.member_id === payload.id;
        return {
          id: ev.id,
          scores:
            typeof ev.scores === "string" ? JSON.parse(ev.scores) : ev.scores,
          comment: canSeeAllComments || isOwnEval ? ev.comment : null,
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
                id: ev.epreuves.id,
                name: ev.epreuves.name,
                tour: ev.epreuves.tour,
                type: ev.epreuves.type,
                // Total de points de l'épreuve, pour que le client puisse
                // ramener chaque note sur une base commune avant de moyenner.
                // Sans lui, une épreuve notée /5 et une notée /20 pèsent
                // identiquement dans la moyenne affichée en délibération.
                maxTotal: getTotalMaxPoints(ev.epreuves.evaluation_questions),
              }
            : null,
        };
      });

      const wishes = (c.candidate_wishes || [])
        .sort((a: any, b: any) => (a.rank || 99) - (b.rank || 99))
        .map((w: any) => ({
          pole: w.pole,
          rank: w.rank,
          wantsBureau: !!w.wants_bureau,
          posteDetail: w.poste_detail || null,
        }));

      const delib = Array.isArray(c.deliberations)
        ? c.deliberations[0] || null
        : c.deliberations;

      return {
        id: c.id,
        firstName: c.first_name,
        lastName: c.last_name,
        // Un examinateur non-admin voit l'identité, le téléphone, les notes,
        // les vœux et les commentaires d'évaluation — pas l'email, le parcours
        // scolaire ni les notes internes de l'équipe recrutement.
        email: canSeeAllComments ? c.email : undefined,
        phone: c.phone,
        formation: canSeeAllComments ? c.formation : undefined,
        comments: canSeeAllComments ? c.comments : undefined,
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
