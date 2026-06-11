import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { broadcastReplacementRequest } from "@/lib/auto-allocate";
import { filterActiveEnrollments } from "@/lib/enrollment";
import { NextRequest } from "next/server";

// POST /api/slots/toggle-member — toggle member assignment on a slot
// Features :
// - Anti-double-booking : un membre ne peut pas être affecté à 2 créneaux qui se chevauchent
// - Auto-remplacement : quand un membre est retiré, on promeut automatiquement
//   le premier membre en attente (dans slot_availability_requests) pour ce créneau
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  // SECURITY (audit #4): only members (incl. admin) can toggle member
  // assignments. A candidate token would otherwise inject its own id
  // as a member on a slot.
  if (payload.role !== "member") {
    return Response.json({ error: "Accès interdit" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { slotId, action } = body;
    // Admin peut spécifier un memberId arbitraire, sinon on prend l'utilisateur connecté
    const memberId =
      payload.isAdmin && body.memberId ? body.memberId : payload.id;
    if (!slotId) {
      return Response.json({ error: "slotId required" }, { status: 400 });
    }

    // Check if already assigned
    const { data: existing } = await supabaseAdmin
      .from("slot_member_assignments")
      .select("id")
      .eq("slot_id", slotId)
      .eq("member_id", memberId)
      .limit(1);

    // Si action explicite fournie par l'admin, respecter; sinon toggle
    const shouldRemove =
      action === "remove" || (!action && existing && existing.length > 0);
    const shouldAdd =
      action === "add" || (!action && (!existing || existing.length === 0));

    if (shouldRemove && existing && existing.length > 0) {
      // ──────────────────────────────────────────────────────────────
      // RETRAIT : Supprimer + tenter une auto-promotion depuis la file
      // ──────────────────────────────────────────────────────────────

      // FIX: protect candidates already enrolled.
      // Block the unenrollment when ALL of:
      //   • at least 1 active candidate is enrolled on this slot
      //   • removing this member would drop us below min_members
      //   • there is no waitlist replacement available
      // Admins bypass this safety to be able to force-remove.
      if (!payload.isAdmin) {
        const { data: slotPreCheck } = await supabaseAdmin
          .from("evaluation_slots")
          .select(
            "id, min_members, status, enrollments:slot_enrollments(id, status), members:slot_member_assignments(member_id), waitlist:slot_availability_requests(member_id)",
          )
          .eq("id", slotId)
          .single();

        if (slotPreCheck) {
          const activeEnrolls = (slotPreCheck.enrollments || []).filter(
            filterActiveEnrollments,
          );
          const memberCountAfter =
            (slotPreCheck.members || []).length - 1;
          const minMembers = slotPreCheck.min_members || 0;
          const assignedIds = new Set(
            (slotPreCheck.members || []).map((m: any) => m.member_id),
          );
          const eligibleWaitlist = (slotPreCheck.waitlist || []).filter(
            (w: any) => w.member_id && !assignedIds.has(w.member_id),
          );

          if (
            activeEnrolls.length > 0 &&
            memberCountAfter < minMembers &&
            eligibleWaitlist.length === 0
          ) {
            return Response.json(
              {
                error:
                  "Désinscription impossible : un candidat est déjà inscrit sur ce créneau et aucun examinateur n'est en file d'attente pour vous remplacer. Contactez l'administrateur.",
                code: "CANDIDATE_ENROLLED_NO_REPLACEMENT",
              },
              { status: 409 },
            );
          }
        }
      }

      const { error: deleteError } = await supabaseAdmin
        .from("slot_member_assignments")
        .delete()
        .eq("id", existing[0].id);

      if (deleteError) throw deleteError;

      // Refetch slot (avec inscriptions pour pouvoir notifier les candidats)
      const { data: slot } = await supabaseAdmin
        .from("evaluation_slots")
        .select(
          "*, members:slot_member_assignments(member_id), enrollments:slot_enrollments(candidate_id, status), epreuve:epreuves(name)",
        )
        .eq("id", slotId)
        .single();

      let promotedMemberId: string | null = null;

      if (slot) {
        // Liste des membres déjà affectés sur ce créneau
        const assignedIds = new Set(
          (slot.members || []).map((m: any) => m.member_id),
        );

        // Chercher un membre en attente (slot_availability_requests) pour ce créneau,
        // qui n'est pas déjà affecté ET qui n'a pas de conflit horaire
        const { data: waitlist } = await supabaseAdmin
          .from("slot_availability_requests")
          .select("member_id, created_at")
          .eq("slot_id", slotId)
          .order("created_at", { ascending: true });

        if (waitlist && waitlist.length > 0) {
          for (const candidate of waitlist) {
            if (assignedIds.has(candidate.member_id)) continue;

            // Vérifier qu'il n'a pas un autre créneau au même moment
            const hasConflict = await memberHasConflict(
              candidate.member_id,
              slot,
              slotId,
            );
            if (hasConflict) continue;

            // Promouvoir : ajouter à slot_member_assignments
            const { error: promoteErr } = await supabaseAdmin
              .from("slot_member_assignments")
              .insert({ slot_id: slotId, member_id: candidate.member_id });

            if (!promoteErr) {
              promotedMemberId = candidate.member_id;
              break;
            }
          }
        }

        // Status downgrade si toujours en dessous du min après promotion
        const newCount =
          (slot.members?.length || 0) - 1 + (promotedMemberId ? 1 : 0);

        if (
          slot.status === "ready" &&
          newCount < (slot.min_members || 0)
        ) {
          await supabaseAdmin
            .from("evaluation_slots")
            .update({ status: "open" })
            .eq("id", slotId);
        }

        // ────────────────────────────────────────────────────────────────
        // NOTIFICATION DE REMPLACEMENT — règles métier :
        //   1. Le planning est publié aux candidats (slot.status === 'published')
        //   2. Il y avait initialement assez d'examinateurs sur ce créneau
        //   3. L'un d'eux s'est désinscrit (on est dans la branche remove)
        //   4. PERSONNE n'a pris sa place (promotedMemberId === null)
        // → broadcast à tous les membres non encore affectés sur ce créneau
        //   pour demander un remplaçant.
        // ────────────────────────────────────────────────────────────────
        // FIX: also trigger replacement broadcast on "ready" slots (not
        // only "published") because those are committed and may already
        // be visible/relevant for upcoming auto-publication.
        if (
          ["published", "ready", "full"].includes(slot.status) &&
          !promotedMemberId &&
          newCount < (slot.min_members || 0)
        ) {
          const { data: allMembers } = await supabaseAdmin
            .from("members")
            .select("id");

          const targets = (allMembers || [])
            .map((m: any) => m.id)
            .filter((id: string) => id !== memberId);

          const dateStr = slot.date
            ? new Date(slot.date).toLocaleDateString("fr-FR", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })
            : "";
          const startTime = String(slot.start_time || "").substring(0, 5);
          const room = slot.room || "—";

          await broadcastReplacementRequest(
            targets,
            `🆘 Besoin d'un remplaçant — ${dateStr} ${startTime} (${room}). Un examinateur s'est désinscrit et personne en file d'attente. Merci de vous porter volontaire si disponible.`,
          );

          // ────────────────────────────────────────────────────────────
          // NOTIFICATION CANDIDATS : leur créneau publié vient de passer
          // sous le minimum d'examinateurs — on les prévient que le
          // créneau est susceptible d'être modifié.
          // ────────────────────────────────────────────────────────────
          const activeEnrolls = (slot.enrollments || []).filter(
            (e: any) => !e.status || e.status === "active",
          );
          if (activeEnrolls.length > 0) {
            const epName = (slot as any)?.epreuve?.name || "Épreuve";
            const candidateRows = activeEnrolls.map((e: any) => ({
              sender_id: null,
              sender_role: "admin",
              sender_name: "Système",
              recipient_id: e.candidate_id,
              recipient_role: "candidate",
              message: `⚠️ Un examinateur s'est désinscrit de votre créneau "${epName}" du ${dateStr} à ${startTime} (salle ${room}). L'équipe recherche un remplaçant — votre créneau pourrait être modifié ou annulé. Surveillez votre calendrier.`,
            }));
            try {
              await supabaseAdmin.from("private_messages").insert(candidateRows);
            } catch (e) {
              console.error("Notification candidats (sous-effectif) échec:", e);
            }
          }
        }
      }

      return Response.json({
        action: "removed",
        promoted_member_id: promotedMemberId,
      });
    } else if (shouldAdd) {
      // ──────────────────────────────────────────────────────────────
      // AJOUT : Vérifier anti-double-booking d'abord
      // ──────────────────────────────────────────────────────────────
      const { data: targetSlot } = await supabaseAdmin
        .from("evaluation_slots")
        .select(
          "id, date, start_time, end_time, epreuve:epreuves(is_pole_test, pole)",
        )
        .eq("id", slotId)
        .single();

      if (!targetSlot) {
        return Response.json({ error: "Créneau introuvable" }, { status: 404 });
      }

      // ──────────────────────────────────────────────────────────────
      // PÔLE : un membre non-admin ne peut s'inscrire comme examinateur
      // sur une épreuve de pôle que si c'est SON pôle. Admin bypass.
      // ──────────────────────────────────────────────────────────────
      const targetEpreuve = (targetSlot as any).epreuve;
      if (
        !payload.isAdmin &&
        targetEpreuve?.is_pole_test &&
        targetEpreuve?.pole
      ) {
        const { data: me } = await supabaseAdmin
          .from("members")
          .select("pole")
          .eq("id", memberId)
          .maybeSingle();
        if (!me?.pole || me.pole !== targetEpreuve.pole) {
          return Response.json(
            {
              error: `Cette épreuve est réservée aux membres du pôle ${targetEpreuve.pole}.`,
            },
            { status: 403 },
          );
        }
      }

      const conflict = await memberHasConflict(memberId, targetSlot, slotId);
      if (conflict) {
        return Response.json(
          {
            error:
              "Conflit horaire : ce membre est déjà sur un autre créneau au même moment",
          },
          { status: 409 },
        );
      }

      // Add assignment
      const { error: insertError } = await supabaseAdmin
        .from("slot_member_assignments")
        .insert({ slot_id: slotId, member_id: memberId });

      if (insertError) {
        if (insertError.code === "23505") {
          return Response.json({ error: "Already assigned" }, { status: 400 });
        }
        throw insertError;
      }

      // Check if slot reaches minMembers threshold
      const { data: slot } = await supabaseAdmin
        .from("evaluation_slots")
        .select("*, members:slot_member_assignments(id)")
        .eq("id", slotId)
        .single();

      const memberCount = slot?.members?.length || 0;

      // ──────────────────────────────────────────────────────────────
      // AUTO-PUBLICATION : si le planning est déjà visible aux candidats
      // ET qu'on vient d'atteindre >= 1 examinateur sur ce créneau non
      // encore publié, on le passe automatiquement à "published".
      // Règle métier : "si des examinateurs s'inscrivent par la suite,
      // le créneau s'ouvre et se publie automatiquement".
      // ──────────────────────────────────────────────────────────────
      if (slot && ["open", "draft", "ready"].includes(slot.status)) {
        // PUBLICATION PAR ÉPREUVE : l'auto-publication ne s'applique que
        // si CETTE épreuve a déjà été publiée par l'admin (≥ 1 créneau
        // published/full). Un examinateur qui s'inscrit sur une épreuve
        // non publiée ne doit PAS exposer son créneau aux candidats.
        let epreuvePublished = false;
        if (slot.epreuve_id) {
          const { count } = await supabaseAdmin
            .from("evaluation_slots")
            .select("id", { count: "exact", head: true })
            .eq("epreuve_id", slot.epreuve_id)
            .in("status", ["published", "full"]);
          epreuvePublished = (count || 0) > 0;
        }

        let newStatus: string | null = null;
        if (epreuvePublished && memberCount >= 1) {
          // Au moins 1 examinateur + épreuve déjà publiée → published
          newStatus = "published";
        } else if (
          slot.status === "open" &&
          memberCount >= (slot.min_members || 0)
        ) {
          // Comportement legacy : open → ready quand minMembers atteint
          newStatus = "ready";
        }

        if (newStatus && newStatus !== slot.status) {
          await supabaseAdmin
            .from("evaluation_slots")
            .update({ status: newStatus })
            .eq("id", slotId);
        }
      }

      return Response.json({ action: "added", memberCount });
    } else {
      return Response.json({ action: "no_change" });
    }
  } catch (error) {
    console.error("Toggle member slot error:", error);
    return Response.json(
      { error: "Failed to toggle slot assignment" },
      { status: 500 },
    );
  }
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────
async function memberHasConflict(
  memberId: string,
  targetSlot: { id: string; date: string; start_time: string; end_time: string },
  excludeSlotId: string,
): Promise<boolean> {
  // Récupérer toutes les autres affectations du membre à la même date
  const { data: otherSlots } = await supabaseAdmin
    .from("slot_member_assignments")
    .select("slot:evaluation_slots(id, date, start_time, end_time)")
    .eq("member_id", memberId);

  if (!otherSlots || otherSlots.length === 0) return false;

  const targetDate = (targetSlot.date || "").substring(0, 10);
  const targetStart = targetSlot.start_time;
  const targetEnd = targetSlot.end_time;

  for (const row of otherSlots as any[]) {
    const s = row.slot;
    if (!s || s.id === excludeSlotId) continue;

    const sDate = (s.date || "").substring(0, 10);
    if (sDate !== targetDate) continue;

    // Overlap check : start1 < end2 && start2 < end1
    if (
      timeLt(targetStart, s.end_time) &&
      timeLt(s.start_time, targetEnd)
    ) {
      return true;
    }
  }

  return false;
}

function timeLt(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a < b;
}
