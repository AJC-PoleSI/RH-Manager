/**
 * dispatch-core — Logique PURE de répartition des examinateurs.
 *
 * Aucune dépendance I/O (pas de Supabase) : ces fonctions sont
 * déterministes et testables unitairement (voir dispatch-core.test.ts).
 * dispatchService.ts (effets de bord + DB) s'appuie dessus.
 */

// ─── Constantes ───────────────────────────────────────────────────────
export const FREEZE_HOURS = 24;
export const PAIR_PENALTY_WEIGHT = 2; // Multiplicateur pénalité binôme

/**
 * Nombre maximum de créneaux CONSÉCUTIFS qu'un examinateur enchaîne dans la
 * même salle avant qu'on cherche à le faire tourner.
 *
 * C'est aussi le garde-fou d'équité : un bonus de continuité fort déséquilibre
 * par construction la charge (un membre « campé » accumule des créneaux) ; ce
 * plafond borne le déséquilibre, puis `memberLoad` reprend la main.
 */
export const ROOM_STREAK_MAX = 3;

/**
 * Bonus (soustrait du score) d'un membre qui continue sa chaîne dans une salle.
 *
 * Volontairement DOMINANT devant la charge (0-10) et la pénalité de binôme
 * (`pairHistory × 2`) : tant que le streak court, la personne ne bouge pas.
 * La souplesse est garantie structurellement — le pool ne contient que des
 * membres réellement disponibles et sans conflit horaire. Quand plusieurs
 * membres de la chaîne sont en concurrence, ils reçoivent tous ce même bonus :
 * charge et binôme les départagent alors normalement.
 */
export const ROOM_CONTINUITY_BONUS = 1000;

/**
 * Bonus (soustrait du score) d'un membre DÉJÀ affecté à ce créneau lors du run
 * précédent. Supprime le brassage gratuit : à situation égale, on ne rebat pas
 * les cartes.
 *
 * Strictement inférieur au plus petit écart significatif (1 pour la charge,
 * 2 pour la pénalité de binôme) : il départage les ex æquo sans jamais pouvoir
 * renverser une décision d'équité.
 */
export const SLOT_ANCHOR_BONUS = 0.5;

// ─── Types ────────────────────────────────────────────────────────────
export interface SlotTiming {
  date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  epreuve_id?: string | null;
}

export interface AvailabilityTiming {
  date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  /**
   * Épreuve pour laquelle la dispo a été cochée. NULL = dispo purement
   * horaire (grille hebdomadaire, données antérieures à la migration
   * `availabilities.epreuve_id`) → comportement historique.
   */
  epreuve_id?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Clé canonique d'une paire (triée pour l'unicité). */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/** "HH:MM" depuis une valeur d'heure quelconque. */
function hhmm(v: string | null | undefined): string {
  return String(v || "").substring(0, 5);
}

/** "YYYY-MM-DD" depuis une valeur de date quelconque. */
function ymd(v: string | null | undefined): string {
  return String(v || "").substring(0, 10);
}

/** Vrai si deux intervalles horaires [aStart,aEnd[ et [bStart,bEnd[ se chevauchent. */
export function timeOverlaps(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Une disponibilité couvre-t-elle un créneau ?
 *
 * - Même jour obligatoire.
 * - Pas d'heure de fin (ancienne donnée) → repli sur l'égalité d'heure de
 *   début (comportement historique, rétro-compatible).
 * - HORAIRES STRICTEMENT IDENTIQUES (même début ET même fin) → la dispo vaut
 *   pour TOUTES les épreuves de ce créneau horaire. Deux épreuves qui tombent
 *   exactement au même moment sont interchangeables du point de vue de
 *   l'examinateur : c'est au dispatch de trancher (cf. compareByTension).
 * - HORAIRES SEULEMENT PARTIELLEMENT SUPERPOSÉS (ex. dispo 14h–15h vs créneau
 *   14h30–15h30) → il faut que la dispo ait été cochée POUR CETTE ÉPREUVE.
 *   Sinon on embarquerait l'examinateur sur une épreuve qu'il n'a pas choisie
 *   et dont l'horaire ne correspond pas au sien.
 * - Dispo sans épreuve (grille hebdomadaire, données historiques) → on garde
 *   le matching par chevauchement d'origine : une dispo 12h00–13h00 couvre un
 *   créneau 12h05–12h50 (c'est ce qui évite qu'une épreuve de groupe se
 *   retrouve sous-staffée parce que les heures de début ne coïncident pas).
 */
export function availabilityMatchesSlot(
  av: AvailabilityTiming,
  slot: SlotTiming,
): boolean {
  if (ymd(av.date) !== ymd(slot.date)) return false;
  const avStart = hhmm(av.start_time);
  const sStart = hhmm(slot.start_time);
  if (!av.end_time) return avStart === sStart;
  const avEnd = hhmm(av.end_time);
  const sEnd = hhmm(slot.end_time) || sStart;

  // Horaires identiques → l'épreuve n'entre pas en ligne de compte.
  if (avStart === sStart && avEnd === sEnd) return true;

  if (!timeOverlaps(avStart, avEnd, sStart, sEnd)) return false;

  // Chevauchement partiel : l'épreuve doit correspondre (sauf dispo héritée
  // sans épreuve, qui garde le comportement historique).
  if (!av.epreuve_id) return true;
  return av.epreuve_id === (slot.epreuve_id ?? null);
}

/** Un créneau est-il gelé (< FREEZE_HOURS avant son début) ? */
export function isFrozen(slot: SlotTiming, now: Date = new Date()): boolean {
  const dateStr = ymd(slot.date);
  const timeStr = hhmm(slot.start_time) || "08:00";
  const slotDate = new Date(`${dateStr}T${timeStr}:00`);
  return slotDate.getTime() - now.getTime() < FREEZE_HOURS * 3600 * 1000;
}

/**
 * Continuité applicable à UN créneau donné (calculée par l'appelant).
 *
 * `continuing` : membres présents sur le créneau précédent de la même salle et
 * dont le streak n'a pas atteint ROOM_STREAK_MAX — on veut les garder sur place.
 * `anchored`   : membres déjà affectés à ce créneau avant que le run l'efface.
 */
export interface SlotContinuity {
  continuing?: Set<string>;
  anchored?: Set<string>;
}

/**
 * Score d'un membre pour un créneau (plus bas = meilleur candidat).
 *
 * Combine la charge (équité), la pénalité de binôme (brassage) et les deux
 * bonus de continuité (rester dans sa salle, ne pas rebrasser gratuitement).
 *
 * La rotation après ROOM_STREAK_MAX créneaux ne demande aucun code dédié : le
 * bonus de chaîne disparaît, et la pénalité de binôme accumulée entre-temps
 * (3 co-affectations = 6 points) sépare le duo d'elle-même.
 */
export function scoreMember(
  memberId: string,
  alreadyPicked: string[],
  memberLoad: Record<string, number>,
  pairHistory: Map<string, number>,
  continuity?: SlotContinuity,
): number {
  const loadScore = memberLoad[memberId] || 0;
  let pairPenalty = 0;
  for (const other of alreadyPicked) {
    const key = pairKey(memberId, other);
    pairPenalty += (pairHistory.get(key) || 0) * PAIR_PENALTY_WEIGHT;
  }

  let bonus = 0;
  if (continuity?.continuing?.has(memberId)) bonus += ROOM_CONTINUITY_BONUS;
  if (continuity?.anchored?.has(memberId)) bonus += SLOT_ANCHOR_BONUS;

  return loadScore + pairPenalty - bonus;
}

/**
 * Depuis combien de créneaux CONSÉCUTIFS ce membre occupe-t-il cette salle ?
 *
 * @param chain          créneaux de la salle ce jour-là, ordre chronologique
 * @param index          position du créneau en cours de décision dans `chain`
 * @param membersBySlot  affectations connues (décidées ou déjà en base)
 *
 * Le parcours remonte tant que le membre était présent, et s'arrête à la
 * première interruption : s'il a quitté la salle, il n'y a plus de continuité
 * à préserver. Borné par ROOM_STREAK_MAX — au-delà la valeur exacte n'a plus
 * d'intérêt, seul le franchissement du plafond compte.
 */
export function roomStreak(
  memberId: string,
  chain: string[],
  index: number,
  membersBySlot: Map<string, Set<string>>,
): number {
  let streak = 0;
  for (let i = index - 1; i >= 0 && streak < ROOM_STREAK_MAX; i--) {
    if (!membersBySlot.get(chain[i])?.has(memberId)) break;
    streak++;
  }
  return streak;
}

/**
 * Réordonne les créneaux pour qu'aucun ne soit servi avant le créneau qui le
 * précède dans sa salle — sans quoi on ne saurait pas qui garder sur place.
 *
 * L'ordre d'entrée (la tension, cf. compareByTension) est PRÉSERVÉ partout où
 * il n'y a pas de lien de chaîne : l'arbitrage entre épreuves simultanées reste
 * intact, on ne fait que remonter les prédécesseurs.
 *
 * Les chaînes d'une salle étant strictement chronologiques, aucun cycle n'est
 * possible ; `emitted` protège malgré tout contre une double émission.
 */
export function orderPredecessorsFirst<T extends { id: string }>(
  slots: T[],
  predecessorOf: Map<string, string>,
): T[] {
  const byId = new Map(slots.map((s) => [s.id, s]));
  const emitted = new Set<string>();
  const ordered: T[] = [];

  const emit = (slot: T) => {
    if (emitted.has(slot.id)) return;
    emitted.add(slot.id); // avant la récursion : coupe tout cycle éventuel
    const predId = predecessorOf.get(slot.id);
    // Un prédécesseur hors du lot (gelé, autre épreuve) n'est pas à servir :
    // son jury est déjà figé et sera lu directement comme ancre.
    const pred = predId ? byId.get(predId) : undefined;
    if (pred) emit(pred);
    ordered.push(slot);
  };

  slots.forEach(emit);
  return ordered;
}

// ─── Tension (arbitrage entre épreuves simultanées) ───────────────────

export interface SlotDemand {
  id: string;
  date?: string | null;
  start_time?: string | null;
  /** Nombre d'examinateurs disponibles pour ce créneau. */
  eligible: number;
  /** Nombre d'examinateurs requis (min_members). */
  quota: number;
  /**
   * Nombre de candidats qui NE POURRONT PAS passer l'épreuve de ce créneau
   * faute de créneaux réellement staffables (cf. epreuveShortfall). 0 = tout
   * le monde passe. C'est le critère PRIORITAIRE d'ordonnancement.
   */
  epreuveDeficit?: number;
  /** Capacité réalisable / candidats à faire passer (1 = pile ce qu'il faut). */
  epreuveCoverage?: number;
}

/**
 * Tension d'une ÉPREUVE : est-elle en mesure de faire passer tous ses
 * candidats avec les créneaux qu'on peut réellement doter en examinateurs ?
 *
 * @param demand   candidats restant à faire passer sur cette épreuve
 * @param capacity places offertes par les créneaux staffables (assez
 *                 d'examinateurs disponibles pour atteindre min_members)
 *
 * `deficit` = candidats laissés sur le carreau (0 si tout le monde passe).
 * `coverage` = ratio de couverture, pour départager deux épreuves à déficit
 * nul (0.9 est plus tendu que 3.0). Sans candidat à faire passer, la
 * couverture est infinie : l'épreuve est servie en dernier.
 */
export function epreuveShortfall(
  demand: number,
  capacity: number,
): { deficit: number; coverage: number } {
  return {
    deficit: Math.max(0, demand - capacity),
    coverage: demand > 0 ? capacity / demand : Number.POSITIVE_INFINITY,
  };
}

/**
 * Tension d'un créneau : marge entre l'offre (examinateurs disponibles) et la
 * demande (quota). Plus le nombre est BAS, plus le créneau est en tension.
 *
 * -1 → il manque un examinateur ; 0 → juste ce qu'il faut ; +5 → confortable.
 */
export function slotTension(eligible: number, quota: number): number {
  return eligible - quota;
}

/**
 * Comparateur d'ordonnancement du dispatch : les créneaux LES PLUS EN TENSION
 * sont servis en premier.
 *
 * C'est ce qui arbitre le cas « un examinateur a coché deux épreuves qui se
 * chevauchent ». Trois critères, dans cet ordre :
 *
 *   1. DÉFICIT DE L'ÉPREUVE — combien de candidats ne pourraient PAS passer
 *      faute de créneaux staffables. Un business game qui laisserait 20
 *      candidats sur le carreau passe avant un entretien individuel qui a
 *      déjà largement de quoi faire passer tout le monde. C'est le critère
 *      métier : on optimise le nombre de candidats évalués, pas le remplissage
 *      des créneaux.
 *   2. COUVERTURE DE L'ÉPREUVE — à déficit égal (typiquement 0 partout), la
 *      moins confortable d'abord.
 *   3. TENSION DU CRÉNEAU — examinateurs disponibles moins quota, puis
 *      chronologie (déterminisme).
 */
export function compareByTension(a: SlotDemand, b: SlotDemand): number {
  const da = a.epreuveDeficit ?? 0;
  const db = b.epreuveDeficit ?? 0;
  if (da !== db) return db - da; // plus gros déficit servi en premier

  const ca = a.epreuveCoverage ?? Number.POSITIVE_INFINITY;
  const cb = b.epreuveCoverage ?? Number.POSITIVE_INFINITY;
  if (ca !== cb) return ca - cb; // couverture la plus faible en premier

  const ta = slotTension(a.eligible, a.quota);
  const tb = slotTension(b.eligible, b.quota);
  if (ta !== tb) return ta - tb;
  if (a.eligible !== b.eligible) return a.eligible - b.eligible;
  const ad = ymd(a.date);
  const bd = ymd(b.date);
  if (ad !== bd) return ad < bd ? -1 : 1;
  const cmp = hhmm(a.start_time).localeCompare(hhmm(b.start_time));
  if (cmp !== 0) return cmp;
  return a.id.localeCompare(b.id);
}
