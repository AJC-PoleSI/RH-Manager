/**
 * tour-generator — crée les créneaux d'un TOUR entier (épreuves de pôle +
 * épreuves ouvertes à tous, comme le Business Game) à partir des dispos
 * saisies UNE SEULE FOIS par les membres.
 *
 * Succède à tour-openings.ts (priorité groupe > individuel, pool global) :
 * ici chaque épreuve a SON vivier de membres éligibles (épreuve de pôle =
 * les membres du pôle, sinon tout le monde) et les membres sont réservés
 * NOMMÉMENT tranche par tranche. C'est ce qui empêche de compter Tom (Dev
 * Co) à la fois pour Dev Co et pour le Business Game à 14h — le dispatch ne
 * pourrait le mettre qu'à un seul endroit, et l'autre créneau resterait sans
 * jury, invisible des candidats.
 *
 * Priorité entre épreuves = CHARGE PAR PERSONNE (places de jury encore à
 * pourvoir ÷ membres éligibles), recalculée à chaque tranche. Décision de
 * Felix (02/10/2026) : « la priorité doit se faire par le nombre de
 * personnes nécessaires et le nombre de candidats à faire passer ».
 *
 * Fonction pure, jamais d'écriture : l'appelant affiche un récapitulatif
 * et n'enregistre qu'après relecture. Relancée plus tard, elle reçoit
 * l'existant (créneaux déjà produits, salles prises, membres déjà affectés)
 * et ne propose que le manque — elle ne supprime jamais rien.
 *
 * Spec : docs/superpowers/specs/2026-10-02-epreuves-de-pole-tour3-design.md
 */

import { CAPACITY_STEP_MIN, type AvailabilityWindow } from "./room-capacity";
import { GRID_START_MIN, GRID_END_MIN, type Band } from "./time-bands";

export interface GeneratorEpreuve {
  epreuveId: string;
  name: string;
  isGroupEpreuve: boolean;
  /** Examinateurs requis par créneau. */
  evaluatorsPerRoom: number;
  /** Durée d'un créneau + roulement, en minutes. */
  slotSpanMin: number;
  /** Créneaux qu'il reste à produire (cible − déjà existants). */
  targetSlots: number;
  /** Membres qui PEUVENT tenir cette épreuve (le pôle, ou tout le monde). */
  eligibleMembers: string[];
  /** Jours autorisés (index dans `days`) ; null/absent = tous. */
  dayIndexes?: number[] | null;
  /** Heures de journée de l'épreuve, en minutes ; défaut = la grille. */
  dayStartMin?: number | null;
  dayEndMin?: number | null;
}

export interface BusyInterval {
  memberId: string;
  startMin: number;
  endMin: number;
}

export interface RoomInterval {
  room: string;
  startMin: number;
  endMin: number;
}

export interface GeneratorDay {
  dayIndex: number;
  /** Dispos fusionnées des membres, ce jour-là. */
  windows: AvailabilityWindow[];
  /** Affectations déjà en base ce jour-là (toutes épreuves, tous tours). */
  busy: BusyInterval[];
  /** Créneaux déjà existants ce jour-là : la salle est prise. */
  roomsTaken: RoomInterval[];
}

export interface GeneratorInput {
  days: GeneratorDay[];
  epreuves: GeneratorEpreuve[];
  /** Liste COMMUNE des salles, dans l'ordre de préférence. */
  rooms: string[];
}

/** Cause dominante d'un manque, pour le récapitulatif. */
export type ShortfallReason =
  | "ok"
  | "no_eligible"
  | "no_members"
  | "no_rooms"
  | "no_days";

export interface GeneratorResult {
  bandsByEpreuve: Record<string, Band[]>;
  remainingByEpreuve: Record<string, number>;
  reasonByEpreuve: Record<string, ShortfallReason>;
}

export const SHORTFALL_LABELS: Record<ShortfallReason, string> = {
  ok: "",
  no_eligible: "aucun membre du pôle",
  no_members: "pas assez de membres disponibles",
  no_rooms: "pas de salle libre",
  no_days: "période épuisée",
};

/**
 * Charge par personne : places de jury encore à pourvoir ÷ membres qui
 * peuvent les tenir. Sans membre éligible, la charge est infinie — ça sert
 * à alerter dans le récapitulatif, jamais à générer.
 */
export function chargeParPersonne(o: {
  remaining: number;
  evaluatorsPerRoom: number;
  eligibleCount: number;
}): number {
  if (o.eligibleCount <= 0) return Number.POSITIVE_INFINITY;
  return (
    (Math.max(0, o.remaining) * Math.max(1, o.evaluatorsPerRoom)) /
    o.eligibleCount
  );
}

const overlaps = (aS: number, aE: number, bS: number, bE: number) =>
  aS < bE && bS < aE;

let seq = 0;
const nextId = () => `gen-${Date.now().toString(36)}-${seq++}`;

export function generateTourSlots(input: GeneratorInput): GeneratorResult {
  const step = CAPACITY_STEP_MIN;
  const bandsByEpreuve: Record<string, Band[]> = {};
  const remaining: Record<string, number> = {};
  const reason: Record<string, ShortfallReason> = {};
  // Réservations par membre sur toute la génération : on étale la charge
  // entre les membres d'un même vivier plutôt que de toujours prendre les
  // mêmes (le dispatch rééquilibrera de toute façon, mais autant lui donner
  // des créneaux tenables par tout le vivier).
  const reservations = new Map<string, number>();

  for (const e of input.epreuves) {
    bandsByEpreuve[e.epreuveId] = [];
    remaining[e.epreuveId] = Math.max(0, e.targetSlots);
    reason[e.epreuveId] =
      e.eligibleMembers.length === 0 && e.targetSlots > 0 ? "no_eligible" : "ok";
  }

  const keyOf = (epreuveId: string, room: string) => `${epreuveId}|${room}`;
  const openSince = new Map<string, number>();
  // Qui tenait cette (épreuve, salle) à la tranche précédente : un créneau à
  // cheval sur deux tranches doit garder les mêmes personnes.
  const crewOf = new Map<string, string[]>();

  const closeBand = (
    e: GeneratorEpreuve,
    room: string,
    dayIndex: number,
    endMin: number,
  ) => {
    const k = keyOf(e.epreuveId, room);
    const start = openSince.get(k);
    if (start === undefined) return;
    openSince.delete(k);
    crewOf.delete(k);
    const slots = Math.floor((endMin - start) / e.slotSpanMin);
    if (slots <= 0) return;
    bandsByEpreuve[e.epreuveId].push({
      id: nextId(),
      dayIndex,
      laneId: room,
      startMin: start,
      endMin,
    });
    remaining[e.epreuveId] = Math.max(0, remaining[e.epreuveId] - slots);
  };

  /** Créneaux produits si l'on fermait toutes les plages ouvertes à `atMin`. */
  const projected = (e: GeneratorEpreuve, atMin: number): number => {
    const closed = Math.max(0, e.targetSlots) - remaining[e.epreuveId];
    let open = 0;
    for (const room of input.rooms) {
      const start = openSince.get(keyOf(e.epreuveId, room));
      if (start !== undefined) open += Math.floor((atMin - start) / e.slotSpanMin);
    }
    return closed + open;
  };
  const needAt = (e: GeneratorEpreuve, atMin: number) =>
    Math.max(0, Math.max(0, e.targetSlots) - projected(e, atMin));

  const allSettled = () =>
    input.epreuves.every((e) => remaining[e.epreuveId] <= 0);

  // La cause la plus ACTIONNABLE l'emporte : « pas de salle » veut dire que
  // des membres étaient là et qu'ouvrir une salle de plus aurait suffi ;
  // « pas assez de membres » à 8h du matin, quand personne n'est encore là,
  // n'apprend rien. « aucun membre du pôle » est posé d'emblée et ne bouge pas.
  const REASON_RANK: Record<ShortfallReason, number> = {
    ok: 0,
    no_days: 1,
    no_members: 2,
    no_rooms: 3,
    no_eligible: 4,
  };
  const noteReason = (e: GeneratorEpreuve, r: ShortfallReason) => {
    if (REASON_RANK[r] > REASON_RANK[reason[e.epreuveId]]) reason[e.epreuveId] = r;
  };

  for (const day of input.days) {
    if (allSettled()) break;
    openSince.clear();
    crewOf.clear();

    for (let t = GRID_START_MIN; t + step <= GRID_END_MIN; t += step) {
      const trancheEnd = t + step;

      // Membres libres sur TOUTE la tranche : dispo couvrante et aucune
      // affectation existante qui la chevauche.
      const free = new Set<string>();
      for (const w of day.windows) {
        if (w.startMin <= t && w.endMin >= trancheEnd) free.add(w.memberId);
      }
      for (const b of day.busy) {
        if (overlaps(b.startMin, b.endMin, t, trancheEnd)) free.delete(b.memberId);
      }

      // Salles prises par l'existant sur cette tranche.
      const roomTaken = new Set<string>();
      for (const r of day.roomsTaken) {
        if (overlaps(r.startMin, r.endMin, t, trancheEnd)) roomTaken.add(r.room);
      }
      // (épreuve|salle) reconduites cette tranche.
      const renewed = new Set<string>();

      // Ordre : charge par personne la plus forte d'abord, recalculée ICI ;
      // à égalité, le vivier le plus petit (il a le moins de solutions).
      const order = input.epreuves
        .filter((e) => needAt(e, t) > 0 && e.eligibleMembers.length > 0)
        .map((e) => ({
          e,
          charge: chargeParPersonne({
            remaining: needAt(e, t),
            evaluatorsPerRoom: e.evaluatorsPerRoom,
            eligibleCount: e.eligibleMembers.length,
          }),
        }))
        .sort((a, b) => {
          if (a.charge !== b.charge) return b.charge - a.charge;
          return a.e.eligibleMembers.length - b.e.eligibleMembers.length;
        })
        .map((x) => x.e);

      for (const e of order) {
        const inDays = !e.dayIndexes || e.dayIndexes.includes(day.dayIndex);
        const dayStart = e.dayStartMin ?? GRID_START_MIN;
        const dayEnd = e.dayEndMin ?? GRID_END_MIN;
        if (!inDays || t < dayStart || trancheEnd > dayEnd) {
          noteReason(e, "no_days");
          continue;
        }
        const perRoom = Math.max(1, e.evaluatorsPerRoom);
        const eligibleSet = new Set(e.eligibleMembers);
        const k = (room: string) => keyOf(e.epreuveId, room);

        const takeCrew = (room: string): string[] | null => {
          const pool = Array.from(free).filter((m) => eligibleSet.has(m));
          if (pool.length < perRoom) return null;
          const previous = crewOf.get(k(room)) ?? [];
          // Continuité d'abord, puis les moins sollicités.
          pool.sort((a, b) => {
            const pa = previous.includes(a) ? 0 : 1;
            const pb = previous.includes(b) ? 0 : 1;
            if (pa !== pb) return pa - pb;
            return (reservations.get(a) ?? 0) - (reservations.get(b) ?? 0);
          });
          const crew = pool.slice(0, perRoom);
          for (const m of crew) {
            free.delete(m);
            reservations.set(m, (reservations.get(m) ?? 0) + 1);
          }
          roomTaken.add(room);
          renewed.add(k(room));
          crewOf.set(k(room), crew);
          return crew;
        };

        // Besoin si toutes les plages ouvertes fermaient MAINTENANT.
        let need = needAt(e, t);

        // 1. Reconduire les plages déjà ouvertes (continuité), tant qu'elles
        //    rapprochent réellement de la cible à la fin de cette tranche.
        for (const room of input.rooms) {
          if (need <= 0) break;
          const start = openSince.get(k(room));
          if (start === undefined || roomTaken.has(room)) continue;
          const delta =
            Math.floor((trancheEnd - start) / e.slotSpanMin) -
            Math.floor((t - start) / e.slotSpanMin);
          if (!takeCrew(room)) {
            noteReason(e, "no_members");
            continue;
          }
          need -= delta;
        }

        // 2. Ouvrir de nouvelles salles tant qu'il reste du besoin, des
        //    membres et des salles. Une plage neuve ne « produit » rien
        //    avant d'atteindre la durée d'un créneau : on la compte pour un,
        //    sinon on ouvrirait toutes les salles d'un coup.
        while (need > 0) {
          const room = input.rooms.find(
            (r) => !roomTaken.has(r) && !openSince.has(k(r)),
          );
          if (!room) {
            noteReason(e, "no_rooms");
            break;
          }
          if (!takeCrew(room)) {
            noteReason(e, "no_members");
            break;
          }
          openSince.set(k(room), t);
          need -= Math.max(1, Math.floor(step / e.slotSpanMin));
        }
      }

      // Plages non reconduites → fermées (salle reprise, effectif manquant,
      // cible atteinte…).
      for (const e of input.epreuves) {
        for (const room of input.rooms) {
          const key = keyOf(e.epreuveId, room);
          if (openSince.has(key) && !renewed.has(key)) {
            closeBand(e, room, day.dayIndex, t);
          }
        }
      }
      // Contrôle exact de fin de tranche : la cible est couverte par les
      // plages ouvertes → on ferme MAINTENANT, pour ne pas retenir des
      // membres que les autres épreuves attendent.
      for (const e of input.epreuves) {
        if (remaining[e.epreuveId] <= 0) continue;
        if (projected(e, trancheEnd) >= Math.max(0, e.targetSlots)) {
          for (const room of input.rooms) {
            closeBand(e, room, day.dayIndex, trancheEnd);
          }
        }
      }
    }

    // Fin de journée : tout ce qui reste ouvert se ferme.
    for (const e of input.epreuves) {
      for (const room of input.rooms) {
        closeBand(e, room, day.dayIndex, GRID_END_MIN);
      }
    }
  }

  for (const e of input.epreuves) {
    if (remaining[e.epreuveId] <= 0) reason[e.epreuveId] = "ok";
  }
  return {
    bandsByEpreuve,
    remainingByEpreuve: remaining,
    reasonByEpreuve: reason,
  };
}
