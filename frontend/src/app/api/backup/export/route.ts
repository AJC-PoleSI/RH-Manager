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
// PostgREST plafonne toute requête à 1000 lignes par défaut et TRONQUE
// silencieusement au-delà — sur un backup, cela veut dire un classeur
// incomplet sans le moindre avertissement (audit du 07/09/2026). On pagine
// donc explicitement jusqu'à épuisement.
const PAGE_SIZE = 1000;

async function fetchAllPages<T = any>(
  buildQuery: () => any,
  label: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    // Garde-fou : au-delà de 50 000 lignes, on arrête et on le signale plutôt
    // que de boucler indéfiniment sur une requête qui ne converge pas.
    if (rows.length >= 50 * PAGE_SIZE) {
      console.warn(`[backup/export] ${label} : arrêt à ${rows.length} lignes.`);
      break;
    }
  }
  return rows;
}

export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (payload.role === "candidate" || !payload.isAdmin) {
    return Response.json({ error: "Accès interdit" }, { status: 403 });
  }

  try {
    const [candidatesData, membersData, slotsData] = await Promise.all([
      fetchAllPages(
        () =>
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
        "candidats",
      ),
      fetchAllPages(
        () =>
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
        "membres",
      ),
      fetchAllPages(
        () =>
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
        "créneaux",
      ),
    ]);

    const slots = slotsData.map((slot: any) => ({
      ...slot,
      enrollments: (slot.enrollments || []).filter(filterActiveEnrollments),
    }));

    return Response.json({
      candidates: candidatesData,
      members: membersData,
      slots,
    });
  } catch (e: any) {
    return Response.json(
      { error: "Échec de la génération du backup", details: e?.message },
      { status: 500 },
    );
  }
}
