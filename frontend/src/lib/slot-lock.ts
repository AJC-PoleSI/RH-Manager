/**
 * slot-lock — Verrouillage d'un créneau.
 *
 * POURQUOI UNE COLONNE ET PAS UN STATUT
 * ─────────────────────────────────────
 * `status` ("open" / "ready" / "published" / "full") est RECALCULÉ à chaque
 * run du dispatch à partir de l'effectif du jury (cf. slotStatusAfterDispatch).
 * Ce n'est donc pas une décision, c'est une conséquence : s'appuyer dessus pour
 * verrouiller reviendrait à figer tout créneau dès qu'il atteint son jury
 * complet — et à le défiger dès qu'un examinateur se désiste.
 *
 * Le verrou est un ACTE, écrit en base au moment où la décision est prise :
 *   - "publication"  : le planning de l'épreuve a été publié aux candidats,
 *   - "inscription"  : un candidat a réservé ce créneau,
 *   - "manuel"       : l'admin l'a figé à la main.
 *
 * CE QUE LE VERROU GOUVERNE : le JURY (qui examine) et l'IDENTITÉ du créneau
 * (date, horaire, salle). Pas le `status`, qui continue de vivre sa vie — un
 * créneau verrouillé qui tombe sous son minimum sans inscrit repasse au pool
 * (invisible des candidats) tout en gardant les examinateurs déjà en place, et
 * se recomplète tout seul au run suivant.
 */

/** Motifs de verrouillage, du plus fort au plus faible. */
export type LockReason = "publication" | "inscription" | "manuel";

/** Sous-ensemble d'un créneau suffisant pour raisonner sur son verrou. */
export interface LockableSlot {
  is_locked?: boolean | null;
  locked_reason?: string | null;
}

/** Le créneau est-il verrouillé ? (tolère la colonne absente en base) */
export function isSlotLocked(slot: LockableSlot | null | undefined): boolean {
  return slot?.is_locked === true;
}

/**
 * Libellé affiché à l'admin (tooltip du cadenas). Le motif doit être lisible
 * sans aller lire le code : c'est tout l'intérêt de stocker `locked_reason`.
 */
export function lockReasonLabel(reason: string | null | undefined): string {
  switch (reason) {
    case "publication":
      return "Planning publié aux candidats";
    case "inscription":
      return "Un candidat est inscrit";
    case "manuel":
      return "Figé manuellement";
    default:
      return "Créneau figé";
  }
}

/** Valeurs à écrire pour poser le verrou. */
export function lockPatch(reason: LockReason): {
  is_locked: true;
  locked_at: string;
  locked_reason: LockReason;
} {
  return {
    is_locked: true,
    locked_at: new Date().toISOString(),
    locked_reason: reason,
  };
}

/** Valeurs à écrire pour retirer le verrou. */
export function unlockPatch(): {
  is_locked: false;
  locked_at: null;
  locked_reason: null;
} {
  return { is_locked: false, locked_at: null, locked_reason: null };
}

/**
 * Vrai si l'erreur signifie « la colonne n'existe pas (encore) en base ».
 *
 * Les migrations Supabase s'appliquent À LA MAIN sur ce projet : entre le
 * déploiement du code et l'exécution du SQL par Felix, la colonne `is_locked`
 * est absente. Sans ce repli, la lecture du dispatch échouerait et le planning
 * entier cesserait d'être recalculé — bien pire que l'absence de verrou.
 * Même logique que le repli `epreuve_id` sur `availabilities`.
 */
export function isMissingColumnError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  // Postgres 42703 = undefined_column. PostgREST PGRST204 = colonne absente
  // du cache de schéma (renvoyé sur les écritures).
  const code = String(e.code ?? "");
  if (code === "42703" || code === "PGRST204") return true;
  const msg = String(e.message ?? "").toLowerCase();
  return (
    msg.includes("column") &&
    (msg.includes("does not exist") || msg.includes("could not find"))
  );
}
