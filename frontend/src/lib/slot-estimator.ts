/**
 * slot-estimator — traduit un nombre de candidats attendus en nombre de
 * créneaux nécessaires.
 *
 * Fonction pure (tests dans slot-estimator.test.ts). N'écrit rien, ne crée
 * aucun créneau : c'est un chiffre affiché à côté de la grille d'ouvertures,
 * pour que l'admin sache s'il a ouvert assez de salles.
 *
 * Pourquoi une marge : les candidats s'inscrivent EUX-MÊMES sur les créneaux
 * une fois publiés. Avec exactement autant de créneaux que de candidats, les
 * derniers inscrits n'ont plus aucun créneau compatible avec leurs propres
 * disponibilités. La marge, c'est du choix laissé aux candidats, pas du
 * gaspillage de salle.
 *
 * Spec : docs/superpowers/specs/2026-09-09-refonte-creneaux-bandes-design.md
 */

export interface EstimatorInput {
  candidatsAttendus: number | null | undefined;
  margePct: number | null | undefined;
  /** Épreuve de groupe : group_size (max/créneau) et min_candidates (min/créneau). */
  isGroupEpreuve?: boolean;
  groupSize?: number | null;
  minCandidates?: number | null;
}

export interface EstimatorResult {
  /** Aucune estimation possible (candidatsAttendus absent ou ≤ 0). */
  applicable: boolean;
  /** Individuelle : une seule valeur. Groupe : fourchette. */
  min: number;
  max: number;
}

const NOT_APPLICABLE: EstimatorResult = { applicable: false, min: 0, max: 0 };

/**
 * Nombre de créneaux nécessaires pour accueillir `candidatsAttendus`
 * candidats, avec la marge de choix demandée.
 *
 * - Individuelle : `ceil(candidats × (1 + marge))`, une seule valeur
 *   (min = max).
 * - Groupe : fourchette entre le plancher optimiste (tout le monde en
 *   groupes au maximum, sans marge — `ceil(C / groupSize)`) et le plafond
 *   réaliste (avec la marge de choix, en dimensionnant sur le minimum de
 *   remplissage accepté — `ceil(C × (1+marge) / minCandidates)`).
 */
export function estimateSlotsNeeded(input: EstimatorInput): EstimatorResult {
  const candidats = Number(input.candidatsAttendus);
  if (!Number.isFinite(candidats) || candidats <= 0) return NOT_APPLICABLE;

  const marge = Math.max(0, Number(input.margePct) || 0) / 100;

  if (!input.isGroupEpreuve) {
    const n = Math.ceil(candidats * (1 + marge));
    return { applicable: true, min: n, max: n };
  }

  const groupSize = Math.max(1, Number(input.groupSize) || 1);
  const minCandidates = Math.max(1, Number(input.minCandidates) || groupSize);

  const min = Math.ceil(candidats / groupSize);
  const max = Math.ceil((candidats * (1 + marge)) / minCandidates);

  return { applicable: true, min: Math.min(min, max), max: Math.max(min, max) };
}

/** Libellé prêt à afficher : "125 créneaux" ou "17 à 32 créneaux". */
export function formatSlotEstimate(r: EstimatorResult): string {
  if (!r.applicable) return "";
  if (r.min === r.max) return `${r.min} créneau${r.min > 1 ? "x" : ""}`;
  return `${r.min} à ${r.max} créneaux`;
}
