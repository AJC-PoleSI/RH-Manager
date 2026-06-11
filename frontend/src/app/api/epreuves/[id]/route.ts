import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";

const isActiveEnrollment = (e: any) => !e.status || e.status === "active";

// Notifie (messagerie interne) les candidats inscrits sur une liste de
// créneaux que ces créneaux sont annulés.
async function notifySlotCancellation(
  slots: any[],
  epreuveName: string,
  reason: string,
): Promise<number> {
  const rows: any[] = [];
  for (const s of slots) {
    const actives = (s.enrollments || []).filter(isActiveEnrollment);
    if (actives.length === 0) continue;
    const dateStr = s.date
      ? new Date(s.date).toLocaleDateString("fr-FR", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })
      : "";
    const startTime = String(s.start_time || "").substring(0, 5);
    const room = s.room || "—";
    for (const e of actives) {
      rows.push({
        sender_id: null,
        sender_role: "admin",
        sender_name: "Système",
        recipient_id: e.candidate_id,
        recipient_role: "candidate",
        message: `⚠️ Votre créneau "${epreuveName}" du ${dateStr} à ${startTime} (salle ${room}) a été annulé : ${reason}. ${reason.includes("supprimée") ? "" : "Merci de vous réinscrire sur un nouveau créneau dès qu'il sera disponible."}`,
      });
    }
  }
  if (rows.length > 0) {
    try {
      await supabaseAdmin.from("private_messages").insert(rows);
    } catch (e) {
      console.error("Notification candidats (annulation créneaux) échec:", e);
    }
  }
  return rows.length;
}

// PUT /api/epreuves/[id]
//
// CASCADE DATES : si les dates de l'épreuve changent et que des créneaux
// existent hors de la nouvelle plage, la route répond d'abord 409 avec un
// récapitulatif (avertissement côté admin). Si l'admin confirme
// (body.confirmSlotCascade = true), les créneaux hors plage sont supprimés
// et les candidats inscrits sont notifiés.
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  const { id } = params;

  try {
    const body = await req.json();
    const updateData: any = {};

    if (body.name !== undefined) updateData.name = body.name;
    if (body.tour !== undefined) updateData.tour = body.tour;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.durationMinutes !== undefined)
      updateData.duration_minutes = Number(body.durationMinutes);
    if (body.roulementMinutes !== undefined)
      updateData.roulement_minutes = Number(body.roulementMinutes);
    if (body.nbSalles !== undefined)
      updateData.nb_salles = Number(body.nbSalles);
    if (body.minEvaluatorsPerSalle !== undefined)
      updateData.min_evaluators_per_salle = Number(body.minEvaluatorsPerSalle);
    if (body.dateDebut !== undefined)
      updateData.date_debut = body.dateDebut
        ? new Date(body.dateDebut).toISOString()
        : null;
    if (body.dateFin !== undefined)
      updateData.date_fin = body.dateFin
        ? new Date(body.dateFin).toISOString()
        : null;
    // Only set inscription_deadline if a non-empty value is provided (column may not exist yet)
    if (body.inscriptionDeadline) {
      updateData.inscription_deadline = new Date(body.inscriptionDeadline).toISOString();
    }
    if (body.isPoleTest !== undefined)
      updateData.is_pole_test = body.isPoleTest;
    if (body.pole !== undefined) updateData.pole = body.pole;
    if (body.isGroupEpreuve !== undefined)
      updateData.is_group_epreuve = Boolean(body.isGroupEpreuve);
    else if (body.type !== undefined)
      updateData.is_group_epreuve = body.type === "groupe";
    if (body.groupSize !== undefined)
      updateData.group_size = Math.max(1, Number(body.groupSize) || 1);
    // Épreuves sur table : heure / salle / présentateur
    if (body.heureDebut !== undefined)
      updateData.heure_debut = body.heureDebut || null;
    if (body.salle !== undefined) updateData.salle = body.salle || null;
    if (body.presentedBy !== undefined)
      updateData.presented_by = body.presentedBy || null;
    if (body.description !== undefined)
      updateData.description = body.description;
    if (body.color !== undefined)
      updateData.color = body.color;
    if (body.evaluationQuestions !== undefined) {
      updateData.evaluation_questions =
        typeof body.evaluationQuestions === "string"
          ? body.evaluationQuestions
          : JSON.stringify(body.evaluationQuestions);
    }

    // ══════════════════════════════════════════════════════════════════
    // CASCADE : détection des créneaux hors de la nouvelle plage de dates
    // ══════════════════════════════════════════════════════════════════
    let slotsToDelete: any[] = [];
    if (
      updateData.date_debut !== undefined ||
      updateData.date_fin !== undefined
    ) {
      const { data: current } = await supabaseAdmin
        .from("epreuves")
        .select("date_debut, date_fin, name")
        .eq("id", id)
        .maybeSingle();

      const newStart =
        updateData.date_debut !== undefined
          ? updateData.date_debut
          : current?.date_debut;
      const newEnd =
        updateData.date_fin !== undefined
          ? updateData.date_fin
          : current?.date_fin;
      const startDay = newStart ? String(newStart).split("T")[0] : null;
      const endDay = newEnd ? String(newEnd).split("T")[0] : null;

      const { data: slots } = await supabaseAdmin
        .from("evaluation_slots")
        .select(
          "id, date, start_time, end_time, room, enrollments:slot_enrollments(candidate_id, status)",
        )
        .eq("epreuve_id", id);

      slotsToDelete = (slots || []).filter((s: any) => {
        const day = String(s.date).split("T")[0];
        if (startDay && day < startDay) return true;
        if (endDay && day > endDay) return true;
        return false;
      });

      if (slotsToDelete.length > 0 && body.confirmSlotCascade !== true) {
        const enrolledCount = slotsToDelete.reduce(
          (sum: number, s: any) =>
            sum + (s.enrollments || []).filter(isActiveEnrollment).length,
          0,
        );
        return Response.json(
          {
            code: "SLOTS_OUT_OF_RANGE",
            affectedSlots: slotsToDelete.length,
            enrolledCandidates: enrolledCount,
            error:
              enrolledCount > 0
                ? `${slotsToDelete.length} créneau(x) existent hors de la nouvelle plage de dates, dont ${enrolledCount} inscription(s) candidat. Ils seront supprimés et les candidats notifiés.`
                : `${slotsToDelete.length} créneau(x) existent hors de la nouvelle plage de dates. Ils seront supprimés (aucun candidat inscrit).`,
          },
          { status: 409 },
        );
      }
    }

    const { data, error } = await supabaseAdmin
      .from("epreuves")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Supabase UPDATE error:", error);
      return Response.json(
        {
          error: error.message || "Failed to update epreuve",
          details: error,
          updatedFields: updateData,
        },
        { status: 400 },
      );
    }

    // ══════════════════════════════════════════════════════════════════
    // CASCADE confirmée : notifier puis supprimer les créneaux hors plage
    // ══════════════════════════════════════════════════════════════════
    let cascade: { deletedSlots: number; notifiedCandidates: number } | null =
      null;
    if (slotsToDelete.length > 0) {
      const notified = await notifySlotCancellation(
        slotsToDelete,
        data.name || "Épreuve",
        "les dates de l'épreuve ont été modifiées",
      );
      const { error: delErr } = await supabaseAdmin
        .from("evaluation_slots")
        .delete()
        .in(
          "id",
          slotsToDelete.map((s: any) => s.id),
        );
      if (delErr) {
        console.error("Suppression créneaux hors plage échec:", delErr);
      }
      cascade = {
        deletedSlots: slotsToDelete.length,
        notifiedCandidates: notified,
      };
    }

    // ══════════════════════════════════════════════════════════════════
    // group_size modifié → répercuter sur la capacité des créneaux
    // existants de l'épreuve (la limite d'inscription suit).
    // ══════════════════════════════════════════════════════════════════
    if (updateData.group_size !== undefined && data.is_group_epreuve) {
      await supabaseAdmin
        .from("evaluation_slots")
        .update({ max_candidates: updateData.group_size })
        .eq("epreuve_id", id);
    }

    return Response.json({ ...data, cascade });
  } catch (error) {
    console.error("PUT /epreuves/:id catch error:", error);
    return Response.json(
      { error: String(error), message: "Failed to update epreuve" },
      { status: 400 },
    );
  }
}

// DELETE /api/epreuves/[id]
// Notifie les candidats inscrits sur les créneaux de l'épreuve, supprime
// les créneaux (sinon ils deviennent orphelins : FK ON DELETE SET NULL),
// puis supprime l'épreuve.
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  const { id } = params;

  try {
    const { data: epreuve } = await supabaseAdmin
      .from("epreuves")
      .select("name")
      .eq("id", id)
      .maybeSingle();

    const { data: slots } = await supabaseAdmin
      .from("evaluation_slots")
      .select(
        "id, date, start_time, end_time, room, enrollments:slot_enrollments(candidate_id, status)",
      )
      .eq("epreuve_id", id);

    const notified = await notifySlotCancellation(
      slots || [],
      epreuve?.name || "Épreuve",
      "l'épreuve a été supprimée",
    );

    if (slots && slots.length > 0) {
      await supabaseAdmin
        .from("evaluation_slots")
        .delete()
        .in(
          "id",
          slots.map((s: any) => s.id),
        );
    }

    const { error } = await supabaseAdmin
      .from("epreuves")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return Response.json({
      success: true,
      deletedSlots: slots?.length || 0,
      notifiedCandidates: notified,
    });
  } catch (error) {
    console.error("DELETE /epreuves/:id error:", error);
    return Response.json(
      { error: "Failed to delete epreuve" },
      { status: 400 },
    );
  }
}
