/**
 * dispatch-io — Écriture ATOMIQUE des affectations examinateurs.
 *
 * Aucune dépendance module-level à Supabase : le client est TOUJOURS injecté.
 * Ces fonctions sont donc testables avec un mock (voir dispatch-io.test.ts),
 * exactement comme dispatch-core.ts pour la logique pure.
 */

export interface AssignmentRow {
  slot_id: string;
  member_id: string;
}

/** Sous-ensemble minimal du client Supabase utilisé ici. */
export interface DispatchClient {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ error: unknown }>;
  from: (table: string) => {
    delete: () => {
      in: (col: string, vals: string[]) => Promise<{ error: unknown }>;
    };
    insert: (rows: unknown[]) => Promise<{ error: unknown }>;
  };
}

/** Vrai si l'erreur signifie « la fonction RPC n'existe pas (encore) ». */
export function isFunctionMissingError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  const code = String(e.code ?? "");
  // PostgREST: PGRST202 = fonction absente du cache de schéma.
  // Postgres:  42883    = undefined_function.
  if (code === "PGRST202" || code === "42883") return true;
  const msg = String(e.message ?? "").toLowerCase();
  return (
    msg.includes("could not find the function") ||
    (msg.includes("function") && msg.includes("does not exist"))
  );
}

export type ApplyMode = "atomic" | "fallback" | "noop";

/**
 * Remplace les affectations examinateurs des créneaux `wipeableSlotIds` par
 * `assignments`, de façon ATOMIQUE via la RPC `replace_slot_assignments`
 * (delete + insert dans UNE seule transaction Postgres → un créneau n'est
 * jamais laissé sans jury si l'insert échoue).
 *
 * - Si la RPC réussit → "atomic".
 * - Si la RPC n'est pas encore déployée (migration non appliquée) → repli sur
 *   l'ancien delete+insert non atomique ("fallback"), pour ne pas casser le
 *   dispatch pendant la fenêtre de déploiement.
 * - Toute AUTRE erreur RPC est PROPAGÉE (throw) : la transaction a tout annulé,
 *   rien n'a changé — l'appelant ne doit donc PAS poursuivre la mise à jour des
 *   statuts de créneaux (qui serait désynchronisée).
 */
export async function applyAssignments(
  client: DispatchClient,
  wipeableSlotIds: string[],
  assignments: AssignmentRow[],
): Promise<ApplyMode> {
  if (wipeableSlotIds.length === 0 && assignments.length === 0) {
    return "noop";
  }

  const { error } = await client.rpc("replace_slot_assignments", {
    p_slot_ids: wipeableSlotIds,
    p_assignments: assignments,
  });

  if (!error) return "atomic";

  if (!isFunctionMissingError(error)) {
    // Échec réel : rollback complet côté Postgres, rien n'a été modifié.
    throw error;
  }

  // ── Repli non atomique (RPC pas encore appliquée) ──
  console.warn(
    "[dispatch] RPC replace_slot_assignments absente — repli delete+insert non atomique. Appliquez la migration supabase-migration-dispatch-atomic.sql.",
  );
  if (wipeableSlotIds.length > 0) {
    const { error: delErr } = await client
      .from("slot_member_assignments")
      .delete()
      .in("slot_id", wipeableSlotIds);
    if (delErr) throw delErr;
  }
  if (assignments.length > 0) {
    const { error: insErr } = await client
      .from("slot_member_assignments")
      .insert(assignments);
    if (insErr) console.error("Insert assignments error (fallback):", insErr);
  }
  return "fallback";
}
