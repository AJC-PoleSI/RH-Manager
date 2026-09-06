import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { filterActiveEnrollments } from "@/lib/enrollment";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/backup/export
//
// Backup complet du recrutement en un seul appel : candidats + évaluations +
// délibérations, examinateurs + évaluations données, planning (créneaux,
// salles, inscriptions et affectations). Consommé côté front pour générer un
// classeur Excel multi-onglets servant de sauvegarde manuelle.
//
// Contrairement à /api/candidates/export, on inclut TOUS les candidats
// (y compris email non vérifié) : un backup doit couvrir l'état réel de la
// base, pas seulement les profils "propres".
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (payload.role === "candidate" || !payload.isAdmin) {
    return Response.json({ error: "Accès interdit" }, { status: 403 });
  }

  try {
    const [candidatesRes, membersRes, slotsRes] = await Promise.all([
      supabaseAdmin
        .from("candidates")
        .select(
          `
          id, first_name, last_name, email, email_verified, phone,
          formation, etablissement, annee_integration, comments, created_at,
          deliberation:deliberations(pros_comment, cons_comment, global_comments, tour1_status, tour2_status, tour3_status),
          candidate_evaluations(
            id, scores, comment, created_at,
            members!member_id(id, email, first_name, last_name),
            epreuves(id, name, tour, type)
          )
        `,
        )
        .order("last_name", { ascending: true }),
      supabaseAdmin
        .from("members")
        .select(
          `
          id, email, first_name, last_name, is_admin, pole_affiliation,
          candidate_evaluations!member_id(
            id, scores, comment, created_at,
            candidates(id, first_name, last_name),
            epreuves(id, name, tour, type)
          )
        `,
        )
        .order("last_name", { ascending: true }),
      supabaseAdmin
        .from("evaluation_slots")
        .select(
          `
          *,
          epreuve:epreuves(id, name, tour, type),
          members:slot_member_assignments(*, member:members(id, email, first_name, last_name)),
          enrollments:slot_enrollments(*, candidate:candidates(id, first_name, last_name, email))
        `,
        )
        .order("date", { ascending: true })
        .order("start_time", { ascending: true }),
    ]);

    if (candidatesRes.error) throw candidatesRes.error;
    if (membersRes.error) throw membersRes.error;
    if (slotsRes.error) throw slotsRes.error;

    const slots = (slotsRes.data || []).map((slot: any) => ({
      ...slot,
      enrollments: (slot.enrollments || []).filter(filterActiveEnrollments),
    }));

    return Response.json({
      candidates: candidatesRes.data || [],
      members: membersRes.data || [],
      slots,
    });
  } catch (e: any) {
    return Response.json(
      { error: "Échec de la génération du backup", details: e?.message },
      { status: 500 },
    );
  }
}
