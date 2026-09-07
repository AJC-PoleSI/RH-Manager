import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// POST /api/slots/reset — admin: clear all evaluation_slots, related assignments
// AND member availabilities for the épreuve's date range (true reset).
// Works even when there are 0 slots, so it can be used to flush stale
// availabilities entered after a previous reset.
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const { epreuveId, slotIds } = await req.json();

    if (!epreuveId && (!slotIds || slotIds.length === 0)) {
      return Response.json(
        { error: "epreuveId ou slotIds requis" },
        { status: 400 },
      );
    }

    // 1. Determine which slot IDs to delete
    let idsToDelete: string[] = [];

    if (epreuveId) {
      const { data: slots } = await supabaseAdmin
        .from("evaluation_slots")
        .select("id")
        .eq("epreuve_id", epreuveId);
      idsToDelete = (slots || []).map((s: any) => s.id);
    } else if (slotIds && slotIds.length > 0) {
      idsToDelete = slotIds;
    }

    // 2. Delete slot-bound data (only if there ARE slots)
    let notifiedCandidates = 0;
    if (idsToDelete.length > 0) {
      // 2a. Notifier les candidats inscrits AVANT de tout supprimer
      try {
        const { data: enrollments } = await supabaseAdmin
          .from("slot_enrollments")
          .select(
            `candidate_id, slot:evaluation_slots(date, start_time, room, epreuve:epreuves(name))`,
          )
          .in("slot_id", idsToDelete);

        if (enrollments && enrollments.length > 0) {
          const rows = enrollments.map((e: any) => {
            const s = e.slot || {};
            const dateStr = s.date
              ? new Date(s.date).toLocaleDateString("fr-FR", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })
              : "";
            const startTime = String(s.start_time || "").substring(0, 5);
            const epName = s.epreuve?.name || "Épreuve";
            return {
              sender_id: null,
              sender_role: "admin",
              sender_name: "Système",
              recipient_id: e.candidate_id,
              recipient_role: "candidate",
              message: `⚠️ Votre créneau "${epName}" du ${dateStr} à ${startTime} a été annulé suite à une réinitialisation. Merci de vous réinscrire dès que de nouveaux créneaux seront publiés.`,
            };
          });
          await supabaseAdmin.from("private_messages").insert(rows);
          notifiedCandidates = rows.length;
        }
      } catch (e) {
        console.error("Reset notifications échec:", e);
      }

      await supabaseAdmin
        .from("slot_enrollments")
        .delete()
        .in("slot_id", idsToDelete);

      await supabaseAdmin
        .from("slot_member_assignments")
        .delete()
        .in("slot_id", idsToDelete);

      try {
        await supabaseAdmin
          .from("slot_availability_requests")
          .delete()
          .in("slot_id", idsToDelete);
      } catch {
        // table may not exist
      }

      const { error: slotError } = await supabaseAdmin
        .from("evaluation_slots")
        .delete()
        .in("id", idsToDelete);
      if (slotError) throw slotError;
    }

    // 2b. Supprimer aussi les ouvertures de salles de l'épreuve (sinon
    //     elles regénéreraient des créneaux fantômes au prochain recalcul)
    if (epreuveId) {
      try {
        await supabaseAdmin
          .from("room_openings")
          .delete()
          .eq("epreuve_id", epreuveId);
      } catch {
        // table absente tant que la migration room_openings n'est pas appliquée
      }
    }

    // 3. ALWAYS clean member availabilities for this épreuve's date range
    //    (runs even when 0 slots existed, so stale data gets flushed)
    let availabilitiesDeleted = 0;
    if (epreuveId) {
      try {
        const { data: epreuve } = await supabaseAdmin
          .from("epreuves")
          .select("date_debut, date_fin")
          .eq("id", epreuveId)
          .single();

        if (epreuve?.date_debut && epreuve?.date_fin) {
          // Normalize to plain YYYY-MM-DD bounds so we cover any time-of-day
          // representation in the availabilities.date column
          const startStr = String(epreuve.date_debut).substring(0, 10);
          const endStr = String(epreuve.date_fin).substring(0, 10);

          const { data: deleted, error: delErr } = await supabaseAdmin
            .from("availabilities")
            .delete()
            .gte("date", `${startStr}T00:00:00.000Z`)
            .lte("date", `${endStr}T23:59:59.999Z`)
            .select("id");

          if (delErr) {
            console.error("Delete availabilities (range) error:", delErr);
          } else {
            availabilitiesDeleted = (deleted || []).length;
          }

          // ATTENTION — ne pas réintroduire de repli « par jour de semaine ».
          //
          // Audit fonctionnel du 07/09/2026 : quand le filtre par plage de
          // dates ne supprimait rien, le code basculait sur un
          // `DELETE ... WHERE weekday IN (...)` SANS aucun autre filtre — ni
          // épreuve, ni membre, ni date. La table `availabilities` mélangeant
          // des lignes datées et des lignes récurrentes par jour de semaine,
          // réinitialiser une épreuve du lundi au vendredi pouvait effacer les
          // disponibilités saisies par TOUS les membres pour un AUTRE tour se
          // déroulant lui aussi en semaine.
          //
          // La plage de dates est le seul lien réel entre une disponibilité et
          // une épreuve (`availabilities` ne porte pas d'`epreuve_id`). Si ce
          // filtre ne trouve rien, la bonne réponse est de ne rien supprimer et
          // de le dire, pas d'élargir la portée.
          if (availabilitiesDeleted === 0) {
            console.warn(
              `[slots/reset] Épreuve ${epreuveId} (${startStr} → ${endStr}) : aucune disponibilité datée sur la plage. ` +
                "Rien n'a été supprimé — les disponibilités récurrentes (sans date) se nettoient depuis l'écran Disponibilités.",
            );
          }
        }
      } catch (err) {
        console.error("Availabilities cleanup error:", err);
      }
    }

    return Response.json({
      message:
        idsToDelete.length > 0
          ? `${idsToDelete.length} créneau(x) supprimé(s), ${availabilitiesDeleted} disponibilité(s) effacée(s), ${notifiedCandidates} candidat(s) notifié(s)`
          : `Aucun créneau, ${availabilitiesDeleted} disponibilité(s) effacée(s)`,
      deleted: idsToDelete.length,
      availabilities_deleted: availabilitiesDeleted,
      notified_candidates: notifiedCandidates,
    });
  } catch (error) {
    console.error("Reset slots error:", error);
    return Response.json(
      {
        error: "Echec de la réinitialisation des créneaux",
        details: String(error),
      },
      { status: 500 },
    );
  }
}
