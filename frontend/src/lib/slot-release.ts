/**
 * slot-release — Remettre un créneau en état après le départ d'un candidat.
 *
 * Deux effets à ne jamais oublier quand une inscription disparaît :
 *
 *   1. LE STATUT. Un créneau passé en "full" reste invisible des candidats
 *      tant qu'on ne le rouvre pas : la place libérée serait perdue.
 *   2. LE VERROU. Le créneau avait été figé PARCE QU'un candidat s'y était
 *      inscrit (`locked_reason = "inscription"`). Le dernier inscrit parti,
 *      plus aucun rendez-vous ne l'ancre : il peut retourner au rebrassage.
 *      Les verrous posés pour une AUTRE raison (publication, décision de
 *      l'admin) survivent évidemment au désistement.
 *
 * Logique extraite de DELETE /api/slots/enroll/[slotId] pour être partagée
 * avec le déplacement de candidat par l'admin : deux copies de cette règle
 * finiraient par diverger, et l'écart ne se verrait que sur une place perdue.
 */
import { supabaseAdmin } from "@/lib/supabase";
import { filterActiveEnrollments } from "@/lib/enrollment";
import { isMissingColumnError, unlockPatch } from "@/lib/slot-lock";

/**
 * Statut à écrire sur un créneau "full" qui vient de libérer une place.
 *
 * Pourquoi "published" dès UN examinateur (audit #7) : si le planning est
 * globalement visible, retomber sur "ready" ferait disparaître le créneau de
 * la liste candidate et la place fraîchement libérée ne servirait à personne.
 */
export function statusAfterRelease(input: {
  planningVisible: boolean;
  memberCount: number;
  minMembers: number;
}): "published" | "ready" | "open" {
  if (input.planningVisible && input.memberCount >= 1) return "published";
  if (input.memberCount >= input.minMembers) return "ready";
  return "open";
}

/** Le planning est-il visible des candidats ? (réglage global) */
async function planningVisibleToCandidates(): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("system_settings")
    .select("value")
    .eq("key", "planning_visible_candidats")
    .maybeSingle();
  return data?.value === "true" || (data?.value as unknown) === true;
}

/**
 * À appeler APRÈS avoir retiré une inscription : rouvre le créneau s'il était
 * complet et lève le verrou « inscription » s'il ne reste plus personne.
 *
 * Best-effort : une désinscription réussie ne doit jamais être annulée parce
 * que la remise en état a échoué.
 */
export async function releaseSlotAfterUnenroll(slotId: string): Promise<void> {
  try {
    const { data: slot } = await supabaseAdmin
      .from("evaluation_slots")
      .select(
        "*, enrollments:slot_enrollments(id, status), members:slot_member_assignments(id)",
      )
      .eq("id", slotId)
      .single();

    if (!slot) return;

    if (slot.status === "full") {
      await supabaseAdmin
        .from("evaluation_slots")
        .update({
          status: statusAfterRelease({
            planningVisible: await planningVisibleToCandidates(),
            memberCount: slot.members?.length || 0,
            minMembers: slot.min_members || 0,
          }),
        })
        .eq("id", slotId);
    }

    if (
      slot.locked_reason === "inscription" &&
      !(slot.enrollments || []).some(filterActiveEnrollments)
    ) {
      const { error: unlockErr } = await supabaseAdmin
        .from("evaluation_slots")
        .update(unlockPatch())
        .eq("id", slotId)
        .eq("locked_reason", "inscription");
      if (unlockErr && !isMissingColumnError(unlockErr)) {
        console.error("Déverrouillage après désistement échoué:", unlockErr);
      }
    }
  } catch (e) {
    console.error("Remise en état du créneau libéré échouée:", slotId, e);
  }
}
