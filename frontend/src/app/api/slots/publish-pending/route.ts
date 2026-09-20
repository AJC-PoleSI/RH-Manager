import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { isMissingColumnError } from "@/lib/slot-lock";
import { fetchAllRows } from "@/lib/supabase-paging";
import {
  planPublication,
  publishedCount,
  summarizePublication,
  todayInParis,
  type PendingSlotLike,
} from "@/lib/publish-understaffing";
import { NextRequest } from "next/server";

// POST /api/slots/publish-pending — publie les créneaux non encore publiés
// (status "draft" ou "open" ou "ready") d'une épreuve en "published".
//
// IMPORTANT : ne touche PAS aux créneaux déjà "published" ni à leurs inscriptions.
// Les candidats déjà inscrits restent inscrits — leur créneau ne bouge pas.
//
// Corps accepté :
//   { epreuveId: string, allowUnderstaffed?: boolean }
//
// `allowUnderstaffed` (la case « publier quand même les créneaux en
// sous-effectif ») publie AUSSI les créneaux qui n'ont pas leur compte
// d'examinateurs, en ramenant leur quota à l'effectif réellement affecté —
// voir lib/publish-understaffing.ts pour le pourquoi de cet alignement.
// Un créneau SANS aucun examinateur n'est jamais publié, case cochée ou non.
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const { epreuveId, allowUnderstaffed } = await req.json();

    if (!epreuveId) {
      return Response.json({ error: "epreuveId requis" }, { status: 400 });
    }

    // Trouver tous les créneaux non publiés pour cette épreuve.
    //
    // Lecture PAGINÉE : PostgREST plafonne toute réponse à 1000 lignes sans
    // erreur ni avertissement. L'épreuve commune dépasse ce seuil — sans
    // pagination, les créneaux au-delà du millième ne seraient jamais publiés
    // et personne ne saurait pourquoi (cf. supabase-paging.ts).
    const { data: pending, error: fetchErr } = await fetchAllRows<
      PendingSlotLike
    >((from, to) =>
      supabaseAdmin
        .from("evaluation_slots")
        .select(
          "id, status, min_members, date, start_time, room, members:slot_member_assignments(id)",
        )
        .eq("epreuve_id", epreuveId)
        .in("status", ["draft", "open", "ready"])
        .order("id")
        .range(from, to),
    );

    if (fetchErr) throw fetchErr;

    // Un créneau ne s'expose aux candidats qu'avec son effectif complet
    // d'examinateurs — sauf décision explicite de l'admin (case cochée), et
    // jamais à zéro examinateur.
    const plan = planPublication(pending, {
      allowUnderstaffed: allowUnderstaffed === true,
      today: todayInParis(),
    });
    const ids = [...plan.staffed, ...plan.understaffed.map((s) => s.slotId)];

    // ── VERROUILLAGE ──
    // Le planning de cette épreuve est annoncé aux candidats : ses créneaux ne
    // doivent plus être rebrassés par le dispatch (qui se relance à chaque
    // sauvegarde de disponibilité et reconstruit sinon le jury de zéro).
    //
    // Écriture PAR FILTRE, sans liste d'ids : PostgREST plafonne toute réponse
    // à 1000 lignes sans erreur ni avertissement, donc une liste d'ids
    // construite depuis une lecture serait amputée en silence sur une grosse
    // épreuve (l'épreuve commune dépasse ce seuil). Le filtre s'applique côté
    // Postgres, sur toutes les lignes concernées, en une transaction.
    //
    // TOUS les créneaux publiés de l'épreuve sont verrouillés, pas seulement
    // ceux de cette passe : un créneau publié lors d'une publication
    // précédente mérite la même protection. C'est aussi pourquoi l'appel a
    // lieu même quand il n'y a rien de nouveau à publier — republier sert
    // alors de rattrapage.
    const lockPublishedSlots = async () => {
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

      if (!lockErr) return;
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
    };

    // Détail renvoyé au client dans TOUS les cas : l'écran planning s'en sert
    // pour dire ce qui reste bloqué, et pourquoi.
    const breakdown = {
      published: publishedCount(plan),
      published_understaffed: plan.understaffed.length,
      // Conservé sous son nom historique : d'anciens clients le lisent.
      skipped_no_examiner: plan.heldUnderstaffed.length + plan.noExaminer.length,
      held_understaffed: plan.heldUnderstaffed.length,
      past_understaffed: plan.pastUnderstaffed.length,
      no_examiner: plan.noExaminer.length,
      understaffed_slots: plan.understaffed,
      held_slots: plan.heldUnderstaffed,
      no_examiner_slots: plan.noExaminer,
    };

    if (ids.length === 0) {
      await lockPublishedSlots();
      return Response.json({
        ...breakdown,
        published: 0,
        message: summarizePublication(plan),
      });
    }

    // ── QUOTA RAMENÉ À L'EFFECTIF RÉEL (créneaux en sous-effectif assumé) ──
    //
    // Fait AVANT le passage en "published" : si l'alignement échoue, rien
    // n'est publié et le créneau reste dans l'état connu. Dans l'autre ordre,
    // un créneau publié avec un quota resté trop haut serait invisible des
    // candidats ET redescendu en "open" au prochain run du dispatch.
    //
    // Les créneaux sont groupés par effectif : un seul UPDATE par valeur
    // distincte plutôt qu'un aller-retour par créneau.
    if (plan.understaffed.length > 0) {
      const byAssigned: Record<number, string[]> = {};
      for (const s of plan.understaffed) {
        (byAssigned[s.assigned] ||= []).push(s.slotId);
      }
      for (const [assigned, slotIds] of Object.entries(byAssigned)) {
        const { error: quotaErr } = await supabaseAdmin
          .from("evaluation_slots")
          .update({ min_members: Number(assigned) })
          .in("id", slotIds);
        if (quotaErr) throw quotaErr;
      }
    }

    // Passer en "published" — les inscriptions existantes (sur d'autres créneaux
    // déjà publiés) ne sont PAS touchées car on filtre sur status non-published
    const { data: updated, error: updErr } = await supabaseAdmin
      .from("evaluation_slots")
      .update({ status: "published" })
      .in("id", ids)
      .select("id");

    if (updErr) throw updErr;

    await lockPublishedSlots();

    // Activer aussi la visibilité du planning si pas déjà fait
    await supabaseAdmin.from("system_settings").upsert(
      [
        { key: "planning_visible_candidats", value: "true" },
        { key: "planning_generated", value: "true" },
      ],
      { onConflict: "key" },
    );

    return Response.json({
      ...breakdown,
      published: updated?.length || 0,
      message: summarizePublication(plan),
    });
  } catch (error) {
    console.error("Publish pending slots error:", error);
    return Response.json(
      { error: "Échec publication", details: String(error) },
      { status: 500 },
    );
  }
}
