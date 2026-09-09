/**
 * tour-openings — arbitre les salles entre les épreuves d'un même TOUR qui
 * se disputent le même pool d'examinateurs, un seul passage.
 *
 * Fonction pure (tests dans tour-openings.test.ts).
 *
 * Ce qui est PARTAGÉ entre les épreuves d'un tour : les candidats (le même
 * effectif passe l'Entretien individuel ET le Business Game) et le pool
 * d'examinateurs (dispos globales, cf. availability-bands.ts). Ce qui n'est
 * PAS partagé : les salles — chaque épreuve garde sa propre liste
 * (room_openings.epreuve_id), comme aujourd'hui. Générer « pour le tour »
 * ne fusionne donc jamais deux listes de salles ; ça arbitre seulement QUI,
 * à chaque tranche horaire, a priorité sur les examinateurs disponibles.
 *
 * La règle, telle que décrite :
 *   1. on regarde les salles disponibles (par épreuve, sa propre liste) ;
 *   2. on regarde l'effectif d'examinateurs présents sur la tranche ;
 *   3. s'il permet du COLLECTIF et qu'une épreuve de groupe du tour a encore
 *      besoin de créneaux, elle est servie en premier ;
 *   4. l'effectif restant sert ensuite l'épreuve INDIVIDUELLE du tour, si
 *      elle a encore besoin de créneaux.
 *
 * Un garde-fou anti-collision empêche d'attribuer la MÊME salle à deux
 * épreuves sur la même tranche, même si leurs listes se recoupent — la
 * première épreuve à la réclamer dans l'ordre de priorité l'obtient, l'autre
 * passe à la salle suivante de sa propre liste.
 *
 * Comptage EXACT, pas d'approximation : le nombre de créneaux qu'une salle
 * ouverte produit est TOUJOURS `floor(durée / (durée créneau + roulement))`,
 * calculé sur la durée réelle de la plage. Dès qu'une épreuve a suffisamment
 * de plages ouvertes pour couvrir sa cible — closes ou encore en cours —, on
 * arrête net : on ne lui laisse pas grignoter des tranches en plus au
 * détriment de l'autre épreuve du tour.
 *
 * Spec : docs/superpowers/specs/2026-09-09-refonte-creneaux-bandes-design.md
 */

import { computeCapacity, CAPACITY_STEP_MIN, type AvailabilityWindow } from "./room-capacity";
import { GRID_START_MIN, GRID_END_MIN, type Band } from "./time-bands";

export interface TourEpreuveNeed {
  epreuveId: string;
  /** Groupe = priorité 1 sur l'effectif dispo ; individuel = priorité 2. */
  isGroupEpreuve: boolean;
  /** Examinateurs requis par salle pour CETTE épreuve. */
  evaluatorsPerRoom: number;
  /** Durée d'un créneau + roulement — pour convertir une plage en nombre de créneaux. */
  slotSpanMin: number;
  /** Nombre de créneaux qu'il reste à produire pour cette épreuve. */
  targetSlots: number;
  /** SA PROPRE liste de salles, dans l'ordre de préférence. */
  rooms: string[];
}

export interface TourDay {
  dayIndex: number;
  /** Fenêtres de dispo des examinateurs, PARTAGÉES par toutes les épreuves du tour. */
  windows: AvailabilityWindow[];
}

export interface TourOpeningsInput {
  days: TourDay[];
  epreuves: TourEpreuveNeed[];
}

export interface TourOpeningsResult {
  /** Bandes générées, par épreuve. */
  bandsByEpreuve: Record<string, Band[]>;
  /** Créneaux encore manquants par épreuve après génération (0 = comblé). */
  remainingByEpreuve: Record<string, number>;
}

let seq = 0;
const nextId = () => `tour-${Date.now().toString(36)}-${seq++}`;

export function generateTourOpenings(input: TourOpeningsInput): TourOpeningsResult {
  // Priorité : épreuves de groupe d'abord (elles réclament plus
  // d'examinateurs par salle — les servir en premier maximise l'usage de
  // l'effectif), puis les individuelles, dans l'ordre reçu au sein de
  // chaque catégorie.
  const priority = [...input.epreuves].sort((a, b) => {
    if (a.isGroupEpreuve !== b.isGroupEpreuve) return a.isGroupEpreuve ? -1 : 1;
    return 0;
  });

  const bandsByEpreuve: Record<string, Band[]> = {};
  // Créneaux qu'il reste à produire — EXACT, décrémenté uniquement quand une
  // bande se ferme (floor(durée / span)), jamais par approximation.
  const remaining: Record<string, number> = {};
  for (const e of input.epreuves) {
    remaining[e.epreuveId] = e.targetSlots;
    bandsByEpreuve[e.epreuveId] = [];
  }

  const openSince = new Map<string, number>();
  const keyOf = (epreuveId: string, room: string) => `${epreuveId}|${room}`;

  const closeBand = (e: TourEpreuveNeed, room: string, dayIndex: number, endMin: number) => {
    const k = keyOf(e.epreuveId, room);
    const start = openSince.get(k);
    if (start === undefined) return;
    openSince.delete(k);
    const slots = Math.floor((endMin - start) / e.slotSpanMin);
    if (slots <= 0) return;
    bandsByEpreuve[e.epreuveId].push({ id: nextId(), dayIndex, laneId: room, startMin: start, endMin });
    remaining[e.epreuveId] = Math.max(0, remaining[e.epreuveId] - slots);
  };

  /** Ce que produirait CETTE épreuve si on fermait toutes ses plages ouvertes maintenant. */
  const projected = (e: TourEpreuveNeed, atMin: number): number => {
    const closedSoFar = e.targetSlots - remaining[e.epreuveId];
    let openContribution = 0;
    for (const room of e.rooms) {
      const start = openSince.get(keyOf(e.epreuveId, room));
      if (start !== undefined) openContribution += Math.floor((atMin - start) / e.slotSpanMin);
    }
    return closedSoFar + openContribution;
  };

  const allSettled = () => input.epreuves.every((e) => remaining[e.epreuveId] <= 0);

  for (const day of input.days) {
    if (allSettled()) break;

    const report = computeCapacity({
      windows: day.windows,
      totalRooms: Math.max(1, ...input.epreuves.map((e) => e.rooms.length)),
      evaluatorsPerGroupRoom: priority.find((e) => e.isGroupEpreuve)?.evaluatorsPerRoom ?? 4,
      evaluatorsPerIndividualRoom: priority.find((e) => !e.isGroupEpreuve)?.evaluatorsPerRoom ?? 2,
    });
    openSince.clear();

    for (const slice of report.slices) {
      const trancheEnd = slice.startMin + CAPACITY_STEP_MIN;
      let effectifRestant = slice.available;
      // Salles physiquement attribuées cette tranche (à QUI que ce soit) —
      // empêche de donner la même salle à deux épreuves en même temps.
      const salleReclameeCetteTranche = new Set<string>();
      // (épreuve, salle) qui ont EFFECTIVEMENT obtenu leur salle cette
      // tranche — distinct du set ci-dessus : une épreuve peut avoir une
      // salle "ouverte" depuis une tranche précédente sans l'avoir reclamée
      // MAINTENANT (une autre épreuve prioritaire l'a prise à sa place).
      const obtenueCetteTranche = new Set<string>();

      for (const e of priority) {
        if (remaining[e.epreuveId] <= 0) continue;
        if (effectifRestant < e.evaluatorsPerRoom) continue;

        for (const room of e.rooms) {
          if (remaining[e.epreuveId] <= 0) break;
          if (effectifRestant < e.evaluatorsPerRoom) break;
          if (salleReclameeCetteTranche.has(room)) continue; // salle prise par une autre épreuve cette tranche

          salleReclameeCetteTranche.add(room);
          obtenueCetteTranche.add(keyOf(e.epreuveId, room));
          effectifRestant -= e.evaluatorsPerRoom;
          if (!openSince.has(keyOf(e.epreuveId, room))) {
            openSince.set(keyOf(e.epreuveId, room), slice.startMin);
          }
        }
      }

      // Toute plage ouverte (épreuve, salle) qui n'a PAS été effectivement
      // reconduite cette tranche se ferme — QUE la salle ait été prise par
      // une autre épreuve, ou simplement libérée faute d'effectif. Vérifier
      // seulement "la salle est-elle prise par quelqu'un" (comme avant)
      // laissait une bande "ouverte" dans la structure sans se fermer quand
      // une autre épreuve la lui prenait : à la reprise plus tard, son
      // horaire de départ n'était jamais réinitialisé, produisant une plage
      // qui couvrait aussi la période où l'autre épreuve occupait
      // PHYSIQUEMENT la même salle — un double-booking silencieux, trouvé en
      // testant sur des données réelles (deux épreuves partageant "205").
      for (const e of input.epreuves) {
        for (const room of e.rooms) {
          const k = keyOf(e.epreuveId, room);
          if (openSince.has(k) && !obtenueCetteTranche.has(k)) {
            closeBand(e, room, day.dayIndex, slice.startMin);
          }
        }
      }

      // Contrôle exact de fin de tranche : si les plages actuellement
      // ouvertes d'une épreuve suffisent déjà à couvrir sa cible, on les
      // ferme MAINTENANT plutôt que de continuer à les faire courir. Sans ce
      // contrôle, une épreuve de groupe qui garde ses salles ouvertes toute
      // une fenêtre continue retient les examinateurs captifs bien après
      // avoir atteint son besoin, privant l'autre épreuve du tour de tout
      // effectif pendant ce temps.
      for (const e of input.epreuves) {
        if (remaining[e.epreuveId] <= 0) continue;
        if (projected(e, trancheEnd) >= e.targetSlots) {
          for (const room of e.rooms) closeBand(e, room, day.dayIndex, trancheEnd);
        }
      }
    }

    // Fin de journée : clôture de toute plage encore ouverte, PUIS vérifie si
    // la cible est désormais atteinte (calcul exact, pas d'approximation).
    const dayEnd = report.slices.length
      ? report.slices[report.slices.length - 1].startMin + CAPACITY_STEP_MIN
      : GRID_START_MIN;
    for (const e of input.epreuves) {
      for (const room of e.rooms) closeBand(e, room, day.dayIndex, dayEnd);
    }
  }

  return { bandsByEpreuve, remainingByEpreuve: remaining };
}

export { GRID_START_MIN, GRID_END_MIN };
