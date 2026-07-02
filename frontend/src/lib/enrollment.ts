/**
 * Enrollment status helpers.
 *
 * The DB schema uses two valid "active" status values:
 *   • "active"   — written by the app since commit 1093675
 *   • "enrolled" — the original DB default/schema value (legacy rows)
 *   • null/undefined — rows created before any status was added
 *
 * All three mean the same thing: the candidate is currently enrolled.
 * Only "cancelled" means the enrollment was revoked.
 *
 * Using a single helper prevents the "enrolled" vs "active" mismatch
 * that caused candidates to appear un-enrolled while the DB blocked
 * new signups — the root cause of the persistent sync bug.
 */

export type EnrollmentStatus =
  | "active"
  | "enrolled"
  | "cancelled"
  | null
  | undefined;

/** Returns true for any status that means "currently enrolled". */
export function isActiveEnrollment(status: EnrollmentStatus): boolean {
  // null / undefined = legacy row with no status column → treat as active
  if (status == null) return true;
  return status === "active" || status === "enrolled";
}

/** Returns true when the enrollment is cancelled. */
export function isCancelledEnrollment(status: EnrollmentStatus): boolean {
  return status === "cancelled";
}

/** Filter helper for use in .filter() callbacks. */
export const filterActiveEnrollments = (
  e: { status?: string | null },
): boolean => isActiveEnrollment(e.status as EnrollmentStatus);

/**
 * Capacité EFFECTIVE d'un créneau — source unique de vérité.
 *
 * Pour une épreuve de groupe, la vraie limite est `group_size` (le
 * `max_candidates` stocké peut être périmé : d'anciens créneaux ont été
 * créés avec max_candidates=1 avant la persistance de group_size, et
 * passaient "complet" dès le 1er inscrit). Pour un entretien individuel,
 * c'est `max_candidates` (défaut 1).
 *
 * DOIT être utilisé par TOUTES les routes qui exposent ou vérifient la
 * capacité (enroll, available, all, my-slots) pour que "X/Y inscrits" et
 * "complet" s'affichent de façon identique côté candidat, membre et admin.
 */
export function effectiveMaxCandidates(slot: {
  max_candidates?: number | null;
  epreuve?: {
    is_group_epreuve?: boolean | null;
    group_size?: number | null;
  } | null;
}): number {
  const base = Number(slot.max_candidates) || 1;
  if (slot.epreuve?.is_group_epreuve) {
    return Math.max(base, Number(slot.epreuve.group_size) || 1);
  }
  return base;
}
