import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";

// POST /api/slots/publish-pending — publie les créneaux non encore publiés
// (status "draft" ou "open" ou "ready") d'une épreuve en "published".
//
// IMPORTANT : ne touche PAS aux créneaux déjà "published" ni à leurs inscriptions.
// Les candidats déjà inscrits restent inscrits — leur créneau ne bouge pas.
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const { epreuveId } = await req.json();

    if (!epreuveId) {
      return Response.json({ error: "epreuveId requis" }, { status: 400 });
    }

    // Trouver tous les créneaux non publiés pour cette épreuve
    // ET dont le jury est AU COMPLET (>= min_members)
    const { data: pending, error: fetchErr } = await supabaseAdmin
      .from("evaluation_slots")
      .select("id, status, min_members, members:slot_member_assignments(id)")
      .eq("epreuve_id", epreuveId)
      .in("status", ["draft", "open", "ready"]);

    if (fetchErr) throw fetchErr;

    // Un créneau ne s'expose aux candidats qu'avec son effectif complet
    // d'examinateurs, pas dès le premier arrivé.
    const ids = (pending || [])
      .filter((s: any) => (s.members?.length || 0) >= (s.min_members || 2))
      .map((s: any) => s.id);

    const skipped = (pending || []).length - ids.length;

    if (ids.length === 0) {
      return Response.json({
        message:
          skipped > 0
            ? `${skipped} créneau(x) ignoré(s) — jury incomplet. Ils seront publiés automatiquement dès que leur effectif d'examinateurs sera atteint.`
            : "Aucun nouveau créneau à publier",
        published: 0,
        skipped_no_examiner: skipped,
      });
    }

    // Passer en "published" — les inscriptions existantes (sur d'autres créneaux
    // déjà publiés) ne sont PAS touchées car on filtre sur status non-published
    const { data: updated, error: updErr } = await supabaseAdmin
      .from("evaluation_slots")
      .update({ status: "published" })
      .in("id", ids)
      .select("id");

    if (updErr) throw updErr;

    // ── VERROUILLAGE ──
    // Le planning de cette épreuve est annoncé aux candidats : ses créneaux ne
    // doivent plus être rebrassés par le dispatch (qui se relance à chaque
    // sauvegarde de disponibilité et reconstruit sinon le jury de zéro).
    //
    // Écriture PAR FILTRE, sans liste d'ids : PostgREST plafonne toute réponse
    // à 1000 lignes sans erreur ni avertissement, donc une liste d'ids
    // construite depuis une lecture serait amputée en silence sur une grosse
    // épreuve (l'épreuve commune dépasse ce seuil). Le filtre s'applique
    // côté Postgres, sur toutes les lignes concernées, en une transaction.
    //
    // Tous les créneaux `published` de l'épreuve sont verrouillés, pas
    // seulement ceux de cette passe : un créneau publié lors d'une publication
    // précédente mérite la même protection.
    const { error: lockErr } = await supabaseAdmin
      .from("evaluation_slots")
      .update({
        is_locked: true,
        locked_at: new Date().toISOString(),
        locked_reason: "publication",
      })
      .eq("epreuve_id", epreuveId)
      .in("status", ["published", "full"])
      .eq("is_locked", false);

    if (lockErr) {
      // Migration `supabase-migration-slot-lock.sql` pas encore appliquée :
      // la publication reste valide, seule la protection manque. On ne fait
      // pas échouer la publication pour autant.
      if (isMissingColumnError(lockErr)) {
        console.warn(
          "[publish-pending] Colonne is_locked absente — créneaux publiés NON verrouillés. Appliquez supabase-migration-slot-lock.sql.",
        );
      } else {
        throw lockErr;
      }
    }

    // Activer aussi la visibilité du planning si pas déjà fait
    await supabaseAdmin.from("system_settings").upsert(
      [
        { key: "planning_visible_candidats", value: "true" },
        { key: "planning_generated", value: "true" },
      ],
      { onConflict: "key" },
    );

    return Response.json({
      message:
        skipped > 0
          ? `${updated?.length || 0} créneau(x) publié(s) · ${skipped} en attente d'un jury complet`
          : `${updated?.length || 0} créneau(x) publié(s) aux candidats`,
      published: updated?.length || 0,
      skipped_no_examiner: skipped,
    });
  } catch (error) {
    console.error("Publish pending slots error:", error);
    return Response.json(
      { error: "Échec publication", details: String(error) },
      { status: 500 },
    );
  }
}
