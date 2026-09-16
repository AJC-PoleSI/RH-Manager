/**
 * evaluation-closure — « Ce candidat est-il ENCORE à évaluer sur cette épreuve ? »
 *
 * Une seule règle, partagée par la liste « Prochains candidats à évaluer »,
 * le formulaire de notation et la garde d'écriture (POST /api/evaluations) :
 * sans elle, les trois divergent et un candidat déjà noté reste proposé.
 *
 * Ce qui CLÔT un couple (candidat, épreuve) :
 *
 *   1. J'ai déjà déposé mon avis individuel dessus.
 *   2. Une note PARTAGÉE (binôme sur un entretien) existe : le serveur n'en
 *      accepte qu'une par candidat et l'attribue à tous les examinateurs du
 *      créneau — personne n'a plus rien à saisir.
 *   3. Sur une ÉPREUVE DE GROUPE (business game), n'importe quel examinateur
 *      a noté le candidat : chaque candidat y est observé par un examinateur
 *      désigné (cf. examiner_targets), pas par les six du créneau. Une
 *      deuxième note serait un doublon.
 *
 * Ce qui ne clôt RIEN :
 *
 *   • Une ligne vide — le formulaire pouvait en créer une à l'ouverture
 *     (« ghost lock » de l'audit #4, cf. lib/evaluation-finalized).
 *   • Une ANCIENNE note collective de business game (`is_group = true` sur une
 *     épreuve de groupe, plus produite depuis le 15/09/2026) : elle décrit le
 *     travail du groupe, pas un candidat. Le candidat reste donc à évaluer —
 *     et c'est exactement ce que l'alerte de couverture doit faire remonter.
 */

import { isFinalizedEvaluation } from "@/lib/evaluation-finalized";

/** Une ligne `candidate_evaluations`, telle que lue en base. */
export interface ClosureEvaluationRow {
  id?: string;
  candidate_id?: string | null;
  epreuve_id?: string | null;
  member_id?: string | null;
  is_group?: boolean | null;
  scores?: unknown;
  comment?: unknown;
}

/** Ce que l'on sait d'un couple (candidat, épreuve). */
export interface ClosureEntry {
  /** Auteurs d'un avis individuel abouti, dans l'ordre de lecture. */
  authorIds: string[];
  /** Auteur de la note partagée (binôme) aboutie, s'il y en a une. */
  sharedAuthorId: string | null;
}

/**
 * Pourquoi c'est clos :
 *   • `mine`   — ma propre note ;
 *   • `shared` — la note partagée du binôme (elle compte aussi pour moi) ;
 *   • `peer`   — un autre examinateur a noté ce candidat (épreuve de groupe).
 */
export type ClosureReason = "mine" | "shared" | "peer";

export interface ClosureVerdict {
  closed: boolean;
  reason: ClosureReason | null;
  /** Membre à l'origine de la clôture (pour l'afficher). */
  byMemberId: string | null;
}

const OPEN: ClosureVerdict = { closed: false, reason: null, byMemberId: null };

/** Clé d'index d'un couple (candidat, épreuve). */
export function closureKey(candidateId: string, epreuveId: string): string {
  return `${candidateId}_${epreuveId}`;
}

/**
 * Indexe les évaluations par couple (candidat, épreuve).
 *
 * `isGroupEpreuve` dit, pour un id d'épreuve, s'il s'agit d'un business game :
 * c'est ce qui distingue une note partagée de binôme (qui clôt) d'une ancienne
 * note collective de groupe (qui ne clôt rien).
 */
export function buildClosureIndex(
  rows: ClosureEvaluationRow[] | null | undefined,
  isGroupEpreuve: (epreuveId: string) => boolean,
): Map<string, ClosureEntry> {
  const index = new Map<string, ClosureEntry>();

  for (const row of rows || []) {
    const candidateId = row?.candidate_id;
    const epreuveId = row?.epreuve_id;
    if (!candidateId || !epreuveId) continue;
    // Une ligne sans note ni commentaire ne prouve rien : elle a pu être
    // créée à l'ouverture du formulaire.
    if (!isFinalizedEvaluation(row)) continue;

    const shared = row.is_group === true;
    // Ancienne note collective de business game : hors jeu.
    if (shared && isGroupEpreuve(epreuveId)) continue;

    const key = closureKey(candidateId, epreuveId);
    let entry = index.get(key);
    if (!entry) {
      entry = { authorIds: [], sharedAuthorId: null };
      index.set(key, entry);
    }

    if (shared) {
      entry.sharedAuthorId = entry.sharedAuthorId ?? row.member_id ?? null;
    } else if (row.member_id && !entry.authorIds.includes(row.member_id)) {
      entry.authorIds.push(row.member_id);
    }
  }

  return index;
}

/**
 * Verdict pour un examinateur donné. `isGroupEpreuve` vaut true pour un
 * business game : la note d'un pair y clôt le candidat pour tout le monde.
 */
export function evaluationClosure(
  index: Map<string, ClosureEntry>,
  params: {
    candidateId: string;
    epreuveId: string;
    memberId: string;
    isGroupEpreuve: boolean;
  },
): ClosureVerdict {
  const entry = index.get(closureKey(params.candidateId, params.epreuveId));
  if (!entry) return OPEN;

  // Ma propre saisie d'abord : c'est le motif le plus parlant pour moi,
  // même si une note partagée existe par ailleurs.
  if (entry.authorIds.includes(params.memberId)) {
    return { closed: true, reason: "mine", byMemberId: params.memberId };
  }

  if (entry.sharedAuthorId) {
    const mine = entry.sharedAuthorId === params.memberId;
    return {
      closed: true,
      reason: mine ? "mine" : "shared",
      byMemberId: entry.sharedAuthorId,
    };
  }

  if (params.isGroupEpreuve && entry.authorIds.length > 0) {
    return { closed: true, reason: "peer", byMemberId: entry.authorIds[0] };
  }

  return OPEN;
}

/** Ce candidat a-t-il reçu une note sur cette épreuve, peu importe de qui ? */
export function hasAnyEvaluation(
  index: Map<string, ClosureEntry>,
  candidateId: string,
  epreuveId: string,
): boolean {
  const entry = index.get(closureKey(candidateId, epreuveId));
  if (!entry) return false;
  return entry.authorIds.length > 0 || entry.sharedAuthorId !== null;
}

// ── Couverture d'un business game : « tout le monde a-t-il été évalué ? » ───

/**
 * Horodatage comparable « YYYY-MM-DD HH:MM » à l'heure de Paris.
 *
 * Les créneaux stockent une date (timestamptz calée à midi UTC, donc le bon
 * jour) et des heures en TEXTE, en heure locale. Comparer des `Date` mélangerait
 * le fuseau du serveur (UTC sur Vercel) et l'heure affichée : on compare donc
 * des chaînes d'horloge murale parisienne, ce qui reste juste en heure d'été
 * comme en heure d'hiver.
 */
export function parisClock(now: Date = new Date()): string {
  // "sv-SE" rend un format ISO ("2026-09-16 18:45:00") directement comparable.
  return now.toLocaleString("sv-SE", { timeZone: "Europe/Paris" }).slice(0, 16);
}

/** Le créneau est-il terminé ? (heure de fin dépassée à Paris) */
export function slotHasEnded(
  slot: { date?: string | null; end_time?: string | null },
  nowClock: string = parisClock(),
): boolean {
  const day = String(slot?.date || "").split("T")[0];
  const end = String(slot?.end_time || "").slice(0, 5);
  if (!day || !end) return false;
  return `${day} ${end}` <= nowClock;
}
