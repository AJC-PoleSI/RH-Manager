import { supabaseAdmin, isMissingTableError } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { broadcastReplacementRequest } from "@/lib/replacement-requests";
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
      {
        const { data: slotPreCheck } = await supabaseAdmin
          .from("evaluation_slots")
          .select(
            "id, date, start_time, end_time, min_members, status, enrollments:slot_enrollments(id, status), members:slot_member_assignments(member_id), waitlist:slot_availability_requests(member_id), epreuve:epreuves(is_group_epreuve, group_size)",
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

          // ──────────────────────────────────────────────────────────
          // SUR-EFFECTIF CANDIDATS (épreuves de groupe, TOUS rôles y
          // compris admin) : la capacité candidats est plafonnée par le
          // nombre d'examinateurs (enrollment.ts::effectiveMaxCandidates).
          // Retirer cet examinateur ne doit jamais laisser plus de
          // candidats inscrits que la nouvelle capacité — sinon la salle
          // se retrouve avec, par ex., 6 candidats pour 3 examinateurs.
          // ──────────────────────────────────────────────────────────
          const epreuveForSlot = (slotPreCheck as any).epreuve;
          if (epreuveForSlot?.is_group_epreuve) {
            const groupSize = Math.max(
              1,
              Number(epreuveForSlot.group_size) || 1,
            );
            const newEffectiveMax = Math.max(
              0,
              Math.min(groupSize, memberCountAfter),
            );
            if (activeEnrolls.length > newEffectiveMax) {
              return Response.json(
                {
                  error: `Impossible de retirer cet examinateur : ${activeEnrolls.length} candidat(s) sont déjà inscrits sur ce créneau, retirer ce membre ferait tomber la capacité à ${newEffectiveMax}. Trouvez un remplaçant avant de retirer, ou déplacez d'abord des candidats.`,
                  code: "WOULD_OVERBOOK_CANDIDATES",
                },
                { status: 409 },
              );
            }
          }

          // Admins bypass CETTE garde (pas celle du sur-effectif ci-dessus)
          // pour pouvoir force-retirer même sans remplaçant en file.
          if (!payload.isAdmin) {
            const assignedIds = new Set(
              (slotPreCheck.members || []).map((m: any) => m.member_id),
            );
            // BUG FIX (trouvé en test local) : ce filtre n'excluait que les
            // membres déjà affectés, pas ceux en conflit horaire — alors que
            // la promotion réelle plus bas (memberHasConflict) les exclut.
            // Résultat : la garde laissait passer une désinscription en
            // pensant qu'un remplaçant existait, puis personne n'était
            // promu → créneau sous l'effectif minimum avec un candidat
            // inscrit et aucun garde-fou déclenché.
            const waitlistCandidates = (slotPreCheck.waitlist || []).filter(
              (w: any) => w.member_id && !assignedIds.has(w.member_id),
            );
            const eligibleWaitlist = [];
            for (const w of waitlistCandidates) {
              const hasConflict = await memberHasConflict(
                w.member_id,
                slotPreCheck as any,
                slotId,
              );
              if (!hasConflict) eligibleWaitlist.push(w);
            }

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
      }

      const { error: deleteError } = await supabaseAdmin
        .from("slot_member_assignments")
        .delete()
        .eq("id", existing[0].id);

      if (deleteError) throw deleteError;

      // Se retirer soi-même d'un créneau, c'est retirer sa disponibilité :
      // sans ça le prochain dispatch nous y remettrait aussitôt (cf.
      // syncSelfAvailability).
      if (memberId === payload.id) {
        await syncSelfAvailability(memberId, slotId, "remove");
      }

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

        // Status downgrade si toujours en dessous du min après promotion.
        // BUG FIX #1 : ne couvrait que "ready" (visible staff seulement) — un
        // créneau déjà "published"/"full" (visible candidats) qui perdait un
        // examinateur sans remplaçant restait affiché comme si de rien
        // n'était, avec moins que le minimum d'examinateurs requis. On
        // repasse aussi ces statuts à "open" pour le retirer de la liste
        // des créneaux proposés aux NOUVEAUX candidats (ceux déjà inscrits
        // continuent de le voir via la règle "isEnrolled toujours visible"
        // dans /api/slots/available).
        // BUG FIX #2 (trouvé en testant le fix #1) : `slot` est refetché
        // APRÈS le DELETE (ligne ~155) — `slot.members.length` est donc
        // DÉJÀ le compte post-retrait, pas besoin d'un `-1` supplémentaire.
        // Cet off-by-one préexistait (masqué : sur "ready" seul, une salle à
        // min+1 qui retombait à min repassait à tort "open" — impact limité
        // côté staff). Une fois étendu à "published"/"full" il aurait fait
        // disparaître aux candidats des salles pourtant encore au complet.
        const newCount =
          (slot.members?.length || 0) + (promotedMemberId ? 1 : 0);

        if (
          ["ready", "published", "full"].includes(slot.status) &&
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

          // Ne pas notifier les membres déjà affectés à un autre créneau qui
          // chevauche cet horaire (même dans une autre salle) — ils ne
          // peuvent de toute façon pas se porter volontaires.
          const { data: otherAssignments } = await supabaseAdmin
            .from("slot_member_assignments")
            .select("member_id, slot:evaluation_slots(date, start_time, end_time)")
            .neq("slot_id", slotId);

          const slotDateStr = String(slot.date || "").substring(0, 10);
          const slotStart = String(slot.start_time || "").substring(0, 5);
          const slotEnd = String(slot.end_time || "").substring(0, 5);
          const busyMemberIds = new Set(
            (otherAssignments || [])
              .filter((a: any) => {
                const s = a.slot;
                if (!s) return false;
                if (String(s.date || "").substring(0, 10) !== slotDateStr)
                  return false;
                const oStart = String(s.start_time || "").substring(0, 5);
                const oEnd = String(s.end_time || "").substring(0, 5);
                return timeLt(slotStart, oEnd) && timeLt(oStart, slotEnd);
              })
              .map((a: any) => a.member_id),
          );

          const targets = (allMembers || [])
            .map((m: any) => m.id)
            .filter((id: string) => id !== memberId && !busyMemberIds.has(id));

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
          "id, date, start_time, end_time, epreuve_id, min_members, epreuve:epreuves(is_pole_test, pole, is_group_epreuve, group_size)",
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

      // ──────────────────────────────────────────────────────────────
      // SURPLUS EXAMINATEURS (épreuves de groupe uniquement) : un créneau
      // ne doit recevoir plus que son minimum d'examinateurs que si les
      // autres salles au même horaire (même épreuve, même date+heure)
      // ont elles-mêmes déjà atteint leur minimum — sinon on invite à
      // staffer l'autre salle en priorité plutôt que d'empiler ici.
      // Voir docs/superpowers/specs/2026-09-07-min-candidats-epreuves-groupe-design.md
      // ──────────────────────────────────────────────────────────────
      if (targetEpreuve?.is_group_epreuve) {
        const { count: currentMemberCount } = await supabaseAdmin
          .from("slot_member_assignments")
          .select("id", { count: "exact", head: true })
          .eq("slot_id", slotId);
        const minMembers = (targetSlot as any).min_members || 0;
        if ((currentMemberCount || 0) >= minMembers) {
          const { data: siblings } = await supabaseAdmin
            .from("evaluation_slots")
            .select("id, room, min_members, members:slot_member_assignments(id)")
            .eq("epreuve_id", (targetSlot as any).epreuve_id)
            .eq("date", (targetSlot as any).date)
            .eq("start_time", (targetSlot as any).start_time)
            .neq("id", slotId);
          const understaffed = (siblings || []).filter(
            (s: any) => (s.members?.length || 0) < (s.min_members || 0),
          );
          if (understaffed.length > 0) {
            return Response.json(
              {
                error: `Ce créneau a déjà son minimum d'examinateurs (${minMembers}). D'autres salles au même horaire ont besoin d'examinateurs en priorité : ${understaffed.map((s: any) => s.room).join(", ")}.`,
                code: "SIBLING_SLOTS_UNDERSTAFFED",
              },
              { status: 409 },
            );
          }
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
      //
      // `is_manual` : quand c'est un ADMIN qui place un examinateur, le choix
      // est délibéré et le dispatch ne doit plus rebrasser ce créneau (audit du
      // 07/09/2026 — une simple sauvegarde de disponibilités par n'importe quel
      // membre relançait un recalcul global qui pouvait le défaire en silence).
      // Un membre qui s'inscrit lui-même ne verrouille rien : le planning doit
      // rester rééquilibrable.
      const manual = payload.isAdmin === true;
      let insertError: { code?: string } | null = null;
      {
        const res = await supabaseAdmin
          .from("slot_member_assignments")
          .insert({ slot_id: slotId, member_id: memberId, is_manual: manual });
        insertError = res.error;

        // Colonne pas encore posée : on retombe sur l'insertion d'origine.
        if (insertError && isMissingTableError(insertError)) {
          console.warn(
            "[toggle-member] Colonne slot_member_assignments.is_manual absente — " +
              "affectation enregistrée sans protection contre le rebrassage. " +
              "Appliquez MIGRATIONS_A_APPLIQUER.sql.",
          );
          const retry = await supabaseAdmin
            .from("slot_member_assignments")
            .insert({ slot_id: slotId, member_id: memberId });
          insertError = retry.error;
        }
      }

      if (insertError) {
        if (insertError.code === "23505") {
          return Response.json({ error: "Already assigned" }, { status: 400 });
        }
        // 23514 : rejeté par le trigger DB anti-chevauchement
        // (check_member_slot_overlap, cf. MIGRATIONS_A_APPLIQUER.sql). Le
        // pré-check `memberHasConflict` ci-dessus ferme la majorité des cas,
        // mais pas la race entre deux requêtes concurrentes pour le même
        // membre — c'est précisément ce que ce trigger rattrape.
        if (insertError.code === "23514") {
          return Response.json(
            {
              error:
                "Conflit horaire : ce membre est déjà sur un autre créneau au même moment",
            },
            { status: 409 },
          );
        }
        throw insertError;
      }

      // S'inscrire soi-même sur un créneau EST une déclaration de
      // disponibilité : on l'enregistre, sinon le dispatch ne nous voit pas
      // dans le vivier et nous efface au run suivant (cf.
      // syncSelfAvailability). Un admin qui place quelqu'un d'autre ne
      // déclare rien à sa place : son choix est protégé par `is_manual`.
      if (memberId === payload.id) {
        await syncSelfAvailability(memberId, slotId, "add", targetSlot as any);
      }

      // Check if slot reaches minMembers threshold
      const { data: slot } = await supabaseAdmin
        .from("evaluation_slots")
        .select(
          "*, members:slot_member_assignments(id), enrollments:slot_enrollments(id, status)",
        )
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

        // Le créneau ne s'ouvre aux candidats qu'une fois le nombre
        // d'examinateurs AU COMPLET (son minimum), pas dès le premier arrivé.
        //
        // EXCEPTION (spec 2026-09-11) : un créneau où un candidat est DÉJÀ
        // inscrit repasse en circulation dès le PREMIER examinateur. Le
        // rendez-vous est pris ; le garder hors du planning n'aide personne et
        // empêche même le créneau de se compléter.
        const enrolled = activeEnrollmentCount(slot.enrollments);
        const requiredForPublish = enrolled > 0 ? 1 : slot.min_members || 2;

        let newStatus: string | null = null;
        if (epreuvePublished && memberCount >= requiredForPublish) {
          // Examinateurs suffisants + épreuve déjà publiée → published
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

      // ──────────────────────────────────────────────────────────────
      // RÉOUVERTURE D'UN CRÉNEAU "FULL" (épreuves de groupe) : la
      // capacité candidats dépend désormais du nombre d'examinateurs
      // (effectiveMaxCandidates, enrollment.ts). Ajouter un examinateur
      // sur une salle déjà "full" peut donc lui redonner de la place —
      // sans ce garde-fou, staffer davantage une salle ne débloquerait
      // jamais les inscriptions.
      // ──────────────────────────────────────────────────────────────
      if (slot && slot.status === "full" && targetEpreuve?.is_group_epreuve) {
        const { count: activeCount } = await supabaseAdmin
          .from("slot_enrollments")
          .select("id", { count: "exact", head: true })
          .eq("slot_id", slotId)
          .or("status.is.null,status.eq.active,status.eq.enrolled");
        const groupSize = Math.max(
          1,
          Number((targetEpreuve as any).group_size) || 1,
        );
        const newEffectiveMax = Math.min(groupSize, memberCount);
        if ((activeCount || 0) < newEffectiveMax) {
          await supabaseAdmin
            .from("evaluation_slots")
            .update({ status: "published" })
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

/** `availabilities.weekday` est NOT NULL : on le dérive de la date du créneau. */
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * Aligne la disponibilité déclarée d'un membre sur son inscription manuelle à
 * un créneau.
 *
 * POURQUOI. Le dispatch ne connaît qu'une source de vérité : la table
 * `availabilities`. Un examinateur qui s'inscrivait lui-même depuis le planning
 * obtenait bien une affectation, mais aucune disponibilité — il était donc
 * absent du vivier et le recalcul suivant l'effaçait sans un mot. Le diagnostic
 * du 11/09/2026 a relevé 12 affectations dans ce cas. La règle du « jury
 * ancré » (spec 2026-09-11) rend le problème systématique : elle retire
 * précisément les examinateurs sans disponibilité.
 *
 * PORTÉE. Uniquement l'inscription/désinscription PAR LE MEMBRE LUI-MÊME. Un
 * admin qui place quelqu'un ne déclare pas une disponibilité à sa place : son
 * choix est protégé par `is_manual`, qui épingle le créneau.
 *
 * La ligne créée épouse EXACTEMENT le créneau (même jour, mêmes heures, même
 * épreuve), et le retrait ne supprime que cette ligne-là : une plage plus large
 * saisie dans la grille hebdomadaire n'est jamais touchée.
 *
 * Fail-soft : une erreur ici ne doit jamais faire échouer l'affectation
 * elle-même, qui est déjà écrite.
 */
async function syncSelfAvailability(
  memberId: string,
  slotId: string,
  action: "add" | "remove",
  knownSlot?: {
    date?: string | null;
    start_time?: string | null;
    end_time?: string | null;
    epreuve_id?: string | null;
  },
): Promise<void> {
  try {
    let slot = knownSlot;
    if (!slot) {
      const { data } = await supabaseAdmin
        .from("evaluation_slots")
        .select("date, start_time, end_time, epreuve_id")
        .eq("id", slotId)
        .single();
      slot = data || undefined;
    }
    if (!slot) return;

    const ymd = String(slot.date || "").substring(0, 10);
    const start = String(slot.start_time || "").substring(0, 5);
    const end = String(slot.end_time || "").substring(0, 5);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !start || !end) return;

    // Même normalisation que PUT /api/availability : midi UTC, pour que la
    // comparaison de jour reste stable quel que soit le fuseau.
    const date = new Date(`${ymd}T12:00:00.000Z`).toISOString();
    const epreuveId = slot.epreuve_id || null;

    const scope = (q: any) =>
      epreuveId ? q.eq("epreuve_id", epreuveId) : q.is("epreuve_id", null);

    if (action === "remove") {
      await scope(
        supabaseAdmin
          .from("availabilities")
          .delete()
          .eq("member_id", memberId)
          .eq("date", date)
          .eq("start_time", start)
          .eq("end_time", end),
      );
      return;
    }

    const { data: already } = await scope(
      supabaseAdmin
        .from("availabilities")
        .select("id")
        .eq("member_id", memberId)
        .eq("date", date)
        .eq("start_time", start)
        .eq("end_time", end),
    ).limit(1);
    if (already && already.length > 0) return;

    await supabaseAdmin.from("availabilities").insert({
      member_id: memberId,
      weekday: WEEKDAYS[new Date(date).getUTCDay()],
      date,
      start_time: start,
      end_time: end,
      epreuve_id: epreuveId,
    });
  } catch (e) {
    // L'affectation, elle, est déjà enregistrée : on ne la remet pas en cause.
    console.error("syncSelfAvailability error:", e);
  }
}

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
