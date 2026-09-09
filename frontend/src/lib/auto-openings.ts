/**
 * auto-openings — génère les ouvertures de salles À PARTIR de la courbe de
 * capacité, au lieu de laisser l'admin la lire puis tracer à la main.
 *
 * Fonction pure (tests dans auto-openings.test.ts). Ne touche à rien : elle
 * renvoie des bandes, que l'appelant affiche pour relecture avant
 * d'enregistrer — exactement comme un tracé manuel.
 *
 * L'algorithme, tel que décrit :
 *   pour chaque salle disponible, pour chaque tranche de 30 min de la
 *   journée : si l'effectif présent permet de tenir cette salle sur cette
 *   tranche (compte tenu des salles déjà retenues sur les tranches
 *   précédentes), on la retient. Les tranches retenues consécutives pour une
 *   même salle fusionnent en une seule ouverture.
 *
 * On s'arrête dès que la cible de créneaux est atteinte — inutile d'ouvrir
 * plus de salles que ce que l'estimateur réclame.
 *
 * Spec : docs/superpowers/specs/2026-09-09-refonte-creneaux-bandes-design.md
 */

import { computeCapacity, CAPACITY_STEP_MIN, type AvailabilityWindow } from "./room-capacity";
import { GRID_START_MIN, GRID_END_MIN, minutesToHHMM, type Band } from "./time-bands";

export interface AutoOpeningsDay {
  dayIndex: number;
  windows: AvailabilityWindow[];
}

export interface AutoOpeningsInput {
  days: AutoOpeningsDay[];
  rooms: string[];
  evaluatorsPerGroupRoom: number;
  evaluatorsPerIndividualRoom: number;
  /** Durée d'un créneau + roulement, en minutes — sert à estimer combien de
   * créneaux produit une plage, pour savoir quand s'arrêter. */
  slotSpanMin: number;
  /** Nombre de créneaux visé (sortie de l'estimateur). */
  targetSlots: number;
}

export interface AutoOpeningsResult {
  bands: Band[];
  /** Nombre de créneaux que ces bandes produiront approximativement. */
  estimatedSlots: number;
  /** Vrai si la cible a été atteinte sans épuiser la capacité disponible. */
  reachedTarget: boolean;
}

let seq = 0;
const nextId = () => `auto-${Date.now().toString(36)}-${seq++}`;

export function generateOpeningsFromCapacity(
  input: AutoOpeningsInput,
): AutoOpeningsResult {
  const bands: Band[] = [];
  const span = Math.max(1, input.slotSpanMin);
  let estimatedSlots = 0;

  dayLoop: for (const day of input.days) {
    const report = computeCapacity({
      windows: day.windows,
      totalRooms: input.rooms.length,
      evaluatorsPerGroupRoom: input.evaluatorsPerGroupRoom,
      evaluatorsPerIndividualRoom: input.evaluatorsPerIndividualRoom,
    });

    // Pour chaque salle (dans l'ordre), on ouvre les plages contiguës où
    // l'effectif la rend tenable — la salle d'index k n'est ouverte sur une
    // tranche que si cette tranche tient au moins k+1 salles.
    for (let roomIdx = 0; roomIdx < input.rooms.length; roomIdx++) {
      let openStart: number | null = null;

      for (let i = 0; i <= report.slices.length; i++) {
        const slice = report.slices[i];
        const tenable = slice && slice.rooms > roomIdx;

        if (tenable && openStart === null) openStart = slice.startMin;

        if (!tenable && openStart !== null) {
          const end = report.slices[i - 1].startMin + CAPACITY_STEP_MIN;
          const durée = end - openStart;
          if (durée >= span) {
            bands.push({
              id: nextId(),
              dayIndex: day.dayIndex,
              laneId: input.rooms[roomIdx],
              startMin: openStart,
              endMin: end,
            });
            estimatedSlots += Math.floor(durée / span);
          }
          openStart = null;
        }

        if (estimatedSlots >= input.targetSlots) break dayLoop;
      }
    }
  }

  return {
    bands,
    estimatedSlots,
    reachedTarget: estimatedSlots >= input.targetSlots,
  };
}

// Réexport pour les appelants qui veulent afficher l'amplitude utilisée.
export { GRID_START_MIN, GRID_END_MIN, minutesToHHMM };
