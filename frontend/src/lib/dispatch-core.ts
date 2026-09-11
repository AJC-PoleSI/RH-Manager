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

/**
 * Malus (ajouté au score) d'un membre qu'on ARRACHERAIT à une chaîne en cours
 * dans une AUTRE salle pour le placer ici.
 *
 * Symétrique de `ROOM_CONTINUITY_BONUS` : rester sur place et ne pas être
 * délogé sont le même fait physique vu des deux côtés. Le bonus seul ne
 * suffisait pas — il n'agit que lorsqu'on décide le créneau de SA salle. Quand
 * une salle concurrente est servie avant (cas réel du 21/09/2026 : salles 205
 * et 217 proposent le même entretien à 08:30), elle captait le duo, qui se
 * déplaçait pour rien en laissant sa propre salle vide.
 *
 * Ce malus ne peut JAMAIS laisser un créneau non pourvu : le score ne fait
 * qu'ORDONNER le vivier, la boucle gloutonne le vide de toute façon tant qu'il
 * reste des membres disponibles. Il déplace le choix, pas la couverture.
 */
export const UPROOT_PENALTY = 1000;

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

/** "HH:MM" → minutes depuis minuit. */
function minutesOf(v: string): number {
  const [h, m] = String(v || "").substring(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Un engagement (créneau déjà tenu) horodaté, situé dans une salle. */
export interface RoomedCommitment {
  date?: string | null;
  start: string;
  end: string;
  /** Salle physique. Null/absent = inconnue (traitée comme "différente" par prudence, sauf chevauchement strict). */
  room?: string | null;
  /** Roulement (minutes) de l'épreuve de CE créneau — sert de pause minimale exigée en cas de changement de salle. */
  roulementMinutes?: number | null;
}

/**
 * Un engagement bloque-t-il ce créneau pour le même examinateur ?
 *
 * Deux cas :
 *   1. Chevauchement horaire strict → toujours bloqué (impossible physiquement).
 *   2. Pas de chevauchement, mais changement de salle avec un battement
 *      inférieur au roulement le plus exigeant des deux créneaux → bloqué.
 *      Rester dans la MÊME salle ne demande AUCUNE pause : c'est la
 *      continuité voulue (cf. ROOM_STREAK_MAX), pas un enchaînement à éviter.
 *      Salle inconnue d'un côté ou de l'autre → pas de contrainte de pause
 *      (on ne bloque jamais sur une donnée qu'on n'a pas).
 *
 * Bug remonté par Felix le 10/09/2026 : un examinateur enchaînait un Business
 * Game et un entretien individuel dans deux salles différentes à la minute
 * près (créneau A finit à 19:30, créneau B commence à 19:30 ailleurs) — le
 * seul garde-fou existant (`timeOverlaps`) ne voit aucun problème puisque les
 * horaires ne se chevauchent pas.
 */
export function blocksSlot(
  commitment: RoomedCommitment,
  slot: RoomedCommitment,
): boolean {
  if (ymd(commitment.date) !== ymd(slot.date)) return false;
  if (timeOverlaps(commitment.start, commitment.end, slot.start, slot.end))
    return true;
  if (!commitment.room || !slot.room || commitment.room === slot.room)
    return false;

  const requiredGap = Math.max(
    commitment.roulementMinutes || 0,
    slot.roulementMinutes || 0,
  );
  if (requiredGap <= 0) return false;

  const gap =
    commitment.end <= slot.start
      ? minutesOf(slot.start) - minutesOf(commitment.end)
      : minutesOf(commitment.start) - minutesOf(slot.end);
  return gap < requiredGap;
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
 * `uprooting`  : membres en pleine chaîne dans une AUTRE salle, qu'on
 *                délogerait en les prenant ici (cf. UPROOT_PENALTY).
 */
export interface SlotContinuity {
  continuing?: Set<string>;
  anchored?: Set<string>;
  uprooting?: Set<string>;
}

/**
 * Effectif CIBLE du jury pour un créneau — jusqu'où pousser la boucle
 * d'affectation gloutonne avant de s'arrêter.
 *
 * Une épreuve individuelle garde son quota fixe (min_members). Une épreuve
 * de groupe, elle, MONTE avec le vivier réellement disponible : plus il y a
 * d'examinateurs libres, plus le jury grossit — jusqu'au plafond `groupSize`
 * (le nombre max de candidats par groupe, réutilisé comme plafond de jury :
 * pas de champ séparé à configurer). En dessous du minimum, la cible reste
 * le minimum — la boucle d'affectation s'arrêtera de toute façon quand le
 * vivier sera épuisé, sans jamais produire un jury en dessous de ce qui est
 * réellement disponible.
 *
 * Fonction pure : ne regarde PAS combien de personnes sont réellement dans
 * le vivier — c'est au niveau du site d'appel (la boucle gloutonne) que la
 * cible et la disponibilité réelle se rencontrent naturellement.
 */
export function slotFillTarget(
  minMembers: number,
  isGroupEpreuve: boolean | null | undefined,
  groupSize: number | null | undefined,
): number {
  if (!isGroupEpreuve) return minMembers;
  return Math.max(minMembers, groupSize || minMembers);
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

  const uprootPenalty = continuity?.uprooting?.has(memberId)
    ? UPROOT_PENALTY
    : 0;

  return loadScore + pairPenalty + uprootPenalty - bonus;
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
  /**
   * Épreuve de groupe (business game...) plutôt qu'individuelle.
   *
   * Réunir 4 à 6 examinateurs en même temps dans la même salle est
   * structurellement plus difficile que d'en réunir 2 pour un entretien
   * individuel — avec le même vivier disponible, l'individuel dégage un
   * créneau complet bien plus vite. `epreuveDeficit` est censé compenser ça,
   * mais `staffableCapacity` (dispatchService.ts) compte la capacité de
   * chaque créneau de groupe INDÉPENDAMMENT puis les additionne, alors que
   * plusieurs créneaux de groupe simultanés se disputent le MÊME vivier —
   * la capacité calculée d'une épreuve de groupe qui ouvre beaucoup de
   * salles ressort donc gonflée, et son déficit artificiellement faible
   * (audit du 09/09/2026, cf. spec dispatch-priorite-groupe). Ce champ sert
   * de filet de secours explicite : un créneau de groupe passe TOUJOURS
   * avant un individuel qui lui dispute le même horaire.
   */
  isGroupEpreuve?: boolean;
  /**
   * Des candidats se sont déjà inscrits sur ce créneau.
   *
   * Critère le PLUS prioritaire : un rendez-vous pris avec un candidat est un
   * engagement, pas une optimisation. Sans lui, le dispatch pouvait vider le
   * jury d'un créneau où un candidat était inscrit au profit d'un créneau sans
   * personne — 8 cas en base au 11/09/2026, dont plusieurs à 0 examinateur.
   */
  hasEnrolledCandidates?: boolean;
  /**
   * Ce créneau prolonge-t-il une salle DÉJÀ occupée au créneau précédent ?
   *
   * Pur départage, tout en bas de l'ordre : il ne tranche qu'entre créneaux
   * par ailleurs strictement équivalents — typiquement deux salles qui
   * proposent la même épreuve au même horaire. Avant, ce cas tombait sur la
   * comparaison d'UUID (`a.id.localeCompare(b.id)`), donc sur un ordre
   * arbitraire : la salle qui démarrait à froid pouvait être servie en
   * premier, capter l'équipe de la salle voisine et laisser celle-ci vide.
   */
  continuesChain?: boolean;
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
 *   1. TYPE D'ÉPREUVE — un créneau de groupe passe TOUJOURS avant un
 *      individuel qui lui dispute le même vivier d'examinateurs. Réunir 4 à
 *      6 personnes en même temps est structurellement plus dur que d'en
 *      réunir 2 ; sans cette priorité explicite, l'individuel — nombreux
 *      créneaux, quota vite atteint — siphonne le vivier avant que le groupe
 *      n'ait sa vraie chance (observé sur données réelles le 09/09/2026 :
 *      9 examinateurs disponibles, 3 salles business game à 0 examinateur,
 *      pendant que les mêmes personnes tournaient sur des entretiens
 *      individuels au même horaire).
 *   2. DÉFICIT DE L'ÉPREUVE — combien de candidats ne pourraient PAS passer
 *      faute de créneaux staffables. Un business game qui laisserait 20
 *      candidats sur le carreau passe avant un entretien individuel qui a
 *      déjà largement de quoi faire passer tout le monde. C'est le critère
 *      métier : on optimise le nombre de candidats évalués, pas le remplissage
 *      des créneaux.
 *   3. COUVERTURE DE L'ÉPREUVE — à déficit égal (typiquement 0 partout), la
 *      moins confortable d'abord.
 *   4. TENSION DU CRÉNEAU — examinateurs disponibles moins quota, puis
 *      chronologie (déterminisme).
 */
export function compareByTension(a: SlotDemand, b: SlotDemand): number {
  const ea = a.hasEnrolledCandidates ? 1 : 0;
  const eb = b.hasEnrolledCandidates ? 1 : 0;
  if (ea !== eb) return eb - ea; // candidats déjà inscrits d'abord

  const ga = a.isGroupEpreuve ? 1 : 0;
  const gb = b.isGroupEpreuve ? 1 : 0;
  if (ga !== gb) return gb - ga; // groupe d'abord

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
