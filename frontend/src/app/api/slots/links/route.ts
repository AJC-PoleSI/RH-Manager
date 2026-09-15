import { supabaseAdmin, isMissingTableError } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { fetchAllRows } from "@/lib/supabase-paging";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/slots/links — tous les liens de business game (ADMIN uniquement).
 *
 * Sert au planning admin : badger d'un coup d'œil les créneaux de BG qui ont
 * déjà leur lien et, surtout, ceux qui ne l'ont pas. Sans cette vue d'ensemble,
 * vérifier une trentaine de groupes voudrait dire ouvrir trente modales.
 *
 * ADMIN ET PAS « STAFF » : c'est la seule route qui expose des liens hors du
 * périmètre de son jury. Un examinateur n'a rien à y faire — il reçoit le lien
 * de SES créneaux par /api/slots/my-slots.
 *
 * Lecture paginée : la prod dépasse le millier de créneaux, et PostgREST
 * tronque silencieusement à 1000 lignes (cf. lib/supabase-paging.ts).
 */
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const { data, error } = await fetchAllRows<any>((from, to) =>
      supabaseAdmin
        .from("slot_links")
        .select("slot_id, url, label, updated_at")
        .order("slot_id", { ascending: true })
        .range(from, to),
    );

    if (error) {
      // Migration pas encore posée : l'admin doit le savoir (il vient
      // peut-être de cliquer « Enregistrer » sans effet), mais le planning
      // doit continuer de s'afficher.
      if (isMissingTableError(error)) {
        return Response.json({ links: {}, migrationPending: true });
      }
      throw error;
    }

    const links: Record<
      string,
      { url: string; label: string | null; updatedAt: string | null }
    > = {};
    for (const row of data || []) {
      links[row.slot_id] = {
        url: row.url,
        label: row.label ?? null,
        updatedAt: row.updated_at ?? null,
      };
    }

    return new Response(JSON.stringify({ links, migrationPending: false }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error("slot links GET error:", error);
    return Response.json(
      { error: "Échec du chargement des liens" },
      { status: 500 },
    );
  }
}
