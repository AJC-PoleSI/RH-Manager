/**
 * room-capacity — combien de salles peut-on réellement faire tourner, heure
 * par heure, compte tenu des examinateurs présents ?
 *
 * Fonction pure (tests dans room-capacity.test.ts).
 *
 * Le besoin : l'estimateur (slot-estimator.ts) dit combien de créneaux il faut
 * pour les candidats. Il ne dit rien du personnel. Un admin peut donc ouvrir
 * cinq salles à 10h alors que trois examinateurs seulement sont présents — le
 * dispatch crée alors des créneaux que personne ne pourra tenir.
 *
 * La règle appliquée, telle que décrite :
 *   1. on regarde les salles disponibles ;
 *   2. on regarde le nombre d'examinateurs présents à cet instant ;
 *   3. s'il y en a assez pour une épreuve COLLECTIVE, on retient le nombre de
 *      salles que cet effectif permet de tenir en collectif ;
 *   4. sinon, on retombe sur l'entretien INDIVIDUEL, moins gourmand.
 *
 * Spec : docs/superpowers/specs/2026-09-09-refonte-creneaux-bandes-design.md
 */

import { GRID_START_MIN, GRID_END_MIN } from "./time-bands";

/** Pas d'échantillonnage de la courbe. 30 min = lisible sans être grossier. */
export const CAPACITY_STEP_MIN = 30;

export interface AvailabilityWindow {
  memberId: string;
  startMin: number;
  endMin: number;
}

export interface CapacityInput {
  /** Fenêtres de disponibilité des examinateurs, pour UNE journée. */
  windows: AvailabilityWindow[];
  /** Nombre de salles physiquement disponibles — plafonne tout le reste. */
  totalRooms: number;
  /** Examinateurs requis par créneau d'épreuve collective (ex. Business Game : 4). */
  evaluatorsPerGroupRoom: number;
  /** Examinateurs requis par créneau d'entretien individuel (ex. 2). */
  evaluatorsPerIndividualRoom: number;
  stepMin?: number;
}

export type CapacityMode = "groupe" | "individuel" | "aucun";

export interface CapacitySlice {
  startMin: number;
  /** Examinateurs présents sur toute la tranche. */
  available: number;
  /** Salles tenables, après plafonnement par le nombre de salles réelles. */
  rooms: number;
  /** Type d'épreuve que cet effectif permet. */
  mode: CapacityMode;
  /** Salles qu'on pourrait tenir si les salles n'étaient pas le facteur limitant. */
  roomsIfUnlimited: number;
  /** Vrai quand c'est le nombre de salles, et non l'effectif, qui limite. */
  roomLimited: boolean;
}

export interface CapacityReport {
  slices: CapacitySlice[];
  /** Effectif maximum observé dans la journée. */
  peak: number;
  /** Tranches sans aucun examinateur. */
  emptySlices: number;
  /** Salles tenables au mieux dans la journée. */
  maxRooms: number;
}

/**
 * Un examinateur compte pour une tranche s'il couvre la tranche ENTIÈRE.
 *
 * On ne compte pas quelqu'un qui n'est là que dix minutes sur la demi-heure :
 * il ne pourrait pas tenir le créneau jusqu'au bout, et le faire figurer dans
 * la courbe donnerait une capacité qui n'existe pas.
 */
function countAvailable(
  windows: AvailabilityWindow[],
  from: number,
  to: number,
): number {
  const seen = new Set<string>();
  for (const w of windows) {
    if (w.startMin <= from && w.endMin >= to) seen.add(w.memberId);
  }
  return seen.size;
}

export function computeCapacity(input: CapacityInput): CapacityReport {
  const step = input.stepMin ?? CAPACITY_STEP_MIN;
  const perGroup = Math.max(1, input.evaluatorsPerGroupRoom || 1);
  const perIndiv = Math.max(1, input.evaluatorsPerIndividualRoom || 1);
  const totalRooms = Math.max(0, input.totalRooms || 0);

  const slices: CapacitySlice[] = [];
  for (let t = GRID_START_MIN; t + step <= GRID_END_MIN; t += step) {
    const available = countAvailable(input.windows, t, t + step);

    // Étape 3 : assez de monde pour du collectif ? Sinon étape 4, individuel.
    let mode: CapacityMode;
    let roomsIfUnlimited: number;
    if (available >= perGroup) {
      mode = "groupe";
      roomsIfUnlimited = Math.floor(available / perGroup);
    } else if (available >= perIndiv) {
      mode = "individuel";
      roomsIfUnlimited = Math.floor(available / perIndiv);
    } else {
      mode = "aucun";
      roomsIfUnlimited = 0;
    }

    const rooms = Math.min(roomsIfUnlimited, totalRooms);
    slices.push({
      startMin: t,
      available,
      rooms,
      mode,
      roomsIfUnlimited,
      roomLimited: roomsIfUnlimited > totalRooms,
    });
  }

  return {
    slices,
    peak: slices.reduce((m, s) => Math.max(m, s.available), 0),
    emptySlices: slices.filter((s) => s.available === 0).length,
    maxRooms: slices.reduce((m, s) => Math.max(m, s.rooms), 0),
  };
}
