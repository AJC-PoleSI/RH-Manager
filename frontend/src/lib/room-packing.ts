/**
 * room-packing — Regroupement des salles parallèles côté candidat.
 *
 * Logique PURE (aucune I/O), testée unitairement.
 *
 * Problème résolu : à un horaire donné, la même épreuve peut se tenir dans
 * plusieurs salles en parallèle. Jusqu'ici le candidat voyait une ligne par
 * salle et en choisissait une — souvent une salle vide alors qu'une autre
 * était déjà lancée. Résultat mesuré le 11/09/2026 : sur 43 horaires ayant
 * des inscrits, 12 avaient des candidats éparpillés sur 2 ou 3 salles, ce qui
 * oblige les examinateurs à se déplacer pour les suivre.
 *
 * Principe : le candidat choisit un HORAIRE, pas une salle. Le système
 * remplit une salle avant d'en ouvrir une autre.
 */

/** Une salle possible pour un horaire donné. */
export interface RoomOption {
  slotId: string;
  room: string | null;
  /** Candidats déjà inscrits dans cette salle. */
  enrolledCount: number;
  /** Capacité candidats de cette salle (cf. effectiveMaxCandidates). */
  capacity: number;
  /** Au moins un examinateur est affecté à cette salle. */
  juryInPlace: boolean;
}

/**
 * Clé d'un horaire : même épreuve, même date, mêmes heures.
 *
 * Deux salles qui portent la même épreuve au même moment sont
 * interchangeables du point de vue du candidat — c'est précisément ce qui
 * permet de les présenter comme une offre unique.
 */
export function slotGroupKey(slot: {
  epreuve_id?: string | null;
  date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
}): string {
  const ymd = String(slot.date || "").substring(0, 10);
  const start = String(slot.start_time || "").substring(0, 5);
  const end = String(slot.end_time || "").substring(0, 5);
  return `${slot.epreuve_id || "__sans_epreuve__"}|${ymd}|${start}|${end}`;
}

/**
 * Quelle salle attribuer au prochain candidat qui s'inscrit sur cet horaire ?
 *
 * Ordre de préférence (décidé avec Felix le 11/09/2026) :
 *   1. une salle DÉJÀ ENTAMÉE, la plus remplie d'abord — on la finit avant
 *      d'en ouvrir une autre ;
 *   2. à égalité, la salle où le JURY EST DÉJÀ EN PLACE — c'est elle qui
 *      évite un déplacement d'examinateurs ;
 *   3. à égalité stricte, l'identifiant de créneau, pour rester déterministe.
 *
 * Les salles pleines sont écartées. `null` si aucune place n'est disponible.
 */
export function pickPackedRoom(options: RoomOption[]): RoomOption | null {
  const available = options.filter((o) => o.enrolledCount < o.capacity);
  if (available.length === 0) return null;

  const sorted = [...available].sort((a, b) => {
    const startedA = a.enrolledCount > 0 ? 1 : 0;
    const startedB = b.enrolledCount > 0 ? 1 : 0;
    if (startedA !== startedB) return startedB - startedA;
    if (a.enrolledCount !== b.enrolledCount)
      return b.enrolledCount - a.enrolledCount;
    const juryA = a.juryInPlace ? 1 : 0;
    const juryB = b.juryInPlace ? 1 : 0;
    if (juryA !== juryB) return juryB - juryA;
    return a.slotId.localeCompare(b.slotId);
  });

  return sorted[0];
}

/** Un déplacement d'inscription proposé par le regroupement. */
export interface EnrollmentMove {
  candidateId: string;
  fromSlotId: string;
  toSlotId: string;
}

/**
 * Replace les inscriptions EXISTANTES d'un horaire dans les meilleures salles.
 *
 * Deux situations, une seule règle :
 *   • plusieurs salles entamées à moitié → on les rassemble ;
 *   • un candidat seul dans une salle SANS jury alors qu'une autre salle du
 *     même horaire a déjà son équipe → on déplace le candidat, pas l'équipe.
 *     C'est le cas le plus fréquent sur les entretiens individuels, où l'on ne
 *     peut rien fusionner (une salle = un candidat) mais où la salle occupée
 *     n'est pas la bonne.
 *
 * Méthode : on classe les salles (jury en place d'abord, puis les plus
 * remplies — pour déranger le moins de monde possible), on ne retient que le
 * nombre de salles nécessaire à l'effectif, et on redistribue. Un candidat
 * déjà dans une salle retenue n'est jamais déplacé.
 *
 * @param options   les salles de cet horaire
 * @param occupants candidats inscrits, par créneau
 */
export function regroupEnrollments(
  options: RoomOption[],
  occupants: Map<string, string[]>,
): EnrollmentMove[] {
  const ranked = [...options].sort((a, b) => {
    const juryA = a.juryInPlace ? 1 : 0;
    const juryB = b.juryInPlace ? 1 : 0;
    if (juryA !== juryB) return juryB - juryA;
    if (a.enrolledCount !== b.enrolledCount)
      return b.enrolledCount - a.enrolledCount;
    return a.slotId.localeCompare(b.slotId);
  });

  const everyone = ranked.flatMap((o) => occupants.get(o.slotId) || []);
  if (everyone.length === 0) return [];

  // Salles retenues : juste ce qu'il faut pour loger tout le monde.
  const kept: RoomOption[] = [];
  let seats = 0;
  for (const option of ranked) {
    if (seats >= everyone.length) break;
    kept.push(option);
    seats += option.capacity;
  }

  const keptIds = new Set(kept.map((o) => o.slotId));
  const freeSeats = new Map(kept.map((o) => [o.slotId, o.capacity]));

  // Ceux qui sont déjà au bon endroit gardent leur place.
  const toRelocate: Array<{ candidateId: string; fromSlotId: string }> = [];
  for (const option of ranked) {
    for (const candidateId of occupants.get(option.slotId) || []) {
      const seatsLeft = freeSeats.get(option.slotId) || 0;
      if (keptIds.has(option.slotId) && seatsLeft > 0) {
        freeSeats.set(option.slotId, seatsLeft - 1);
      } else {
        toRelocate.push({ candidateId, fromSlotId: option.slotId });
      }
    }
  }

  const moves: EnrollmentMove[] = [];
  for (const { candidateId, fromSlotId } of toRelocate) {
    const target = kept.find((o) => (freeSeats.get(o.slotId) || 0) > 0);
    if (!target) break; // plus de place : on laisse le candidat où il est
    freeSeats.set(target.slotId, (freeSeats.get(target.slotId) || 0) - 1);
    moves.push({ candidateId, fromSlotId, toSlotId: target.slotId });
  }

  return moves;
}
