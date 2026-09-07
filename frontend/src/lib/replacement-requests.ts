import { supabaseAdmin } from "@/lib/supabase";

/**
 * Envoi d'un message privé à une liste de membres (demande de remplacement
 * sur un créneau). Best-effort : les erreurs sont journalisées, pas levées.
 *
 * Historique — ce fichier s'appelait `auto-allocate.ts` et hébergeait aussi
 * `runAutoAllocate`, un SECOND algorithme de répartition concurrent de
 * `dispatchService.runDispatch`. L'audit du 07/09/2026 a montré que les deux
 * divergeaient sur les mêmes données : `runAutoAllocate` ignorait le gel des
 * créneaux à moins de 24h, calculait l'équité globalement au lieu de la
 * calculer par épreuve, ne posait aucun remplaçant, ne notifiait personne et
 * écrivait en delete+insert non atomique. Il n'était plus appelé par aucune
 * page mais restait déclenchable via `POST /api/slots/auto-allocate`, au
 * risque de défaire une répartition faite par `runDispatch`.
 *
 * `runAutoAllocate` et sa route ont donc été supprimés : `runDispatch`
 * (`lib/dispatchService.ts`) est désormais le seul allocateur.
 */
export async function broadcastReplacementRequest(
  memberIds: string[],
  text: string,
): Promise<void> {
  if (memberIds.length === 0) return;
  try {
    const rows = memberIds.map((id) => ({
      sender_id: null,
      sender_role: "admin",
      sender_name: "Système",
      recipient_id: id,
      recipient_role: "member",
      message: text,
    }));
    await supabaseAdmin.from("private_messages").insert(rows);
  } catch (e) {
    console.error("broadcastReplacementRequest error:", e);
  }
}
