/**
 * dispatch-reclaim — Reprendre un examinateur à un créneau SANS candidat pour
 * compléter un créneau où un candidat attend.
 *
 * LE PROBLÈME (constaté sur les données du 11/09/2026)
 * ───────────────────────────────────────────────────
 * Jeudi 17/09 à 16h30, trois salles d'entretien tournent en parallèle :
 *   · salle 205 — 2 examinateurs, 0 candidat
 *   · salle 217 — 2 examinateurs, 0 candidat
 *   · salle 219 — 1 examinateur,  1 candidat  ← le seul rendez-vous réel
 *
 * L'allocation ne sait que PUISER dans le vivier libre : elle sert les
 * créneaux à candidats en premier, mais ne va jamais rechercher quelqu'un
 * déjà posé ailleurs. Une fois Amandine placée salle 205, elle y reste — même
 * si sa salle est vide et que celle d'à côté a un candidat sans jury complet.
 *
 * Le verrouillage des créneaux publiés (slot-lock.ts) a rendu la situation
 * définitive : un créneau vide mais publié garde désormais son jury pour
 * toujours. Cette passe rétablit l'arbitrage, sans rien céder sur la promesse
 * faite aux candidats — on ne prend QUE sur des créneaux où personne n'est
 * inscrit.
 *
 * LA RÈGLE : un créneau sans candidat n'a pas de jury à protéger.
 *
 * Passe exécutée APRÈS l'allocation, sur son résultat : à ce moment le jury de
 * chaque créneau est décidé, donc « qui est où » est connu — ce qui est
 * impossible pendant la boucle, où les créneaux suivants ne sont pas encore
 * servis.
 */

import { blocksSlot, type RoomedCommitment } from "@/lib/dispatch-core";

export interface ReclaimSlot {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  room?: string | null;
  /** Effectif d'examinateurs visé. */
  minMembers: number;
  /** Inscriptions candidates ACTIVES. */
  candidates: number;
  /**
   * Ce run réécrit-il le jury de ce créneau ?
   *
   * Un créneau clôturé, à jury manuel ou gelé n'est PAS réécrit : lui retirer
   * quelqu'un en mémoire ne supprimerait jamais la ligne en base, et
   * l'examinateur se retrouverait sur les deux créneaux à la fois. On ne prend
   * donc que sur des créneaux réécrits.
   */
  wipeable: boolean;
  frozen: boolean;
  /** Temps minimum de changement de salle imposé par l'épreuve. */
  roulementMinutes: number;
}

export interface ReclaimMove {
  memberId: string;
  fromSlotId: string;
  toSlotId: string;
}

interface PlanInput {
  slots: ReclaimSlot[];
  /** Jury planifié par ce run, par créneau. MUTÉ par planReclaims. */
  juryBySlot: Map<string, Set<string>>;
  /** Membres dont les disponibilités couvrent ce créneau. */
  eligibleFor: (slotId: string) => Set<string> | string[];
  /**
   * Engagements que ce run ne recalcule PAS (affectations sur des créneaux
   * hors périmètre, ex. autre épreuve lors d'un run scopé), par membre. Un
   * examinateur n'est jamais déplacé vers un créneau que l'un d'eux bloque —
   * sans ça, un run scopé pouvait le poser sur deux créneaux qui se
   * chevauchent (audit du 12/09/2026).
   */
  fixedCommitments?: Map<string, RoomedCommitment[]>;
}

const commitmentOf = (s: ReclaimSlot) => ({
  date: String(s.date || "").substring(0, 10),
  start: String(s.start_time || "").substring(0, 5),
  end: String(s.end_time || "").substring(0, 5),
  room: s.room ? String(s.room) : null,
  roulementMinutes: s.roulementMinutes || 0,
});

/** Le membre serait-il en conflit sur `target`, en ignorant `exceptSlotId` ? */
function conflictsElsewhere(
  memberId: string,
  target: ReclaimSlot,
  exceptSlotId: string,
  slots: ReclaimSlot[],
  juryBySlot: Map<string, Set<string>>,
  fixedCommitments?: Map<string, RoomedCommitment[]>,
): boolean {
  const t = commitmentOf(target);
  if ((fixedCommitments?.get(memberId) || []).some((c) => blocksSlot(c, t)))
    return true;
  return slots.some(
    (s) =>
      s.id !== exceptSlotId &&
      s.id !== target.id &&
      juryBySlot.get(s.id)?.has(memberId) &&
      blocksSlot(commitmentOf(s), t),
  );
}

/**
 * Calcule (et applique à `juryBySlot`) les reprises nécessaires.
 *
 * Receveurs : créneaux à candidats sous leur effectif, les plus dégarnis
 * d'abord — s'il n'y a qu'un examinateur à reprendre, il va là où il manque
 * le plus.
 *
 * Donneurs : créneaux SANS candidat, réécrits par ce run, qui bloquent le
 * créneau receveur (même horaire, ou changement de salle trop serré) — c'est
 * précisément pour ça que leurs examinateurs n'étaient pas éligibles. On
 * préfère le donneur le plus fourni, pour que la perte porte là où elle se
 * remarque le moins.
 *
 * Le donneur PEUT tomber sous son minimum : il n'a aucun candidat, il
 * repassera simplement hors des créneaux réservables (statut recalculé à
 * l'étape 11). Un rendez-vous pris passe avant une salle vide.
 */
export function planReclaims({
  slots,
  juryBySlot,
  eligibleFor,
  fixedCommitments,
}: PlanInput): ReclaimMove[] {
  const moves: ReclaimMove[] = [];
  const jury = (id: string) => juryBySlot.get(id) || new Set<string>();

  const receivers = slots
    .filter(
      (s) =>
        !s.frozen &&
        s.candidates > 0 &&
        jury(s.id).size < (s.minMembers || 2),
    )
    .sort((a, b) => {
      const ma = (a.minMembers || 2) - jury(a.id).size;
      const mb = (b.minMembers || 2) - jury(b.id).size;
      if (ma !== mb) return mb - ma;
      const da = String(a.date).substring(0, 10);
      const db = String(b.date).substring(0, 10);
      if (da !== db) return da < db ? -1 : 1;
      return String(a.start_time).localeCompare(String(b.start_time));
    });

  for (const receiver of receivers) {
    const eligibleRaw = eligibleFor(receiver.id);
    const eligible =
      eligibleRaw instanceof Set ? eligibleRaw : new Set(eligibleRaw);
    const target = commitmentOf(receiver);

    while (jury(receiver.id).size < (receiver.minMembers || 2)) {
      const donors = slots
        .filter(
          (d) =>
            d.id !== receiver.id &&
            d.wipeable &&
            !d.frozen &&
            d.candidates === 0 &&
            jury(d.id).size > 0 &&
            blocksSlot(commitmentOf(d), target),
        )
        .sort((a, b) => {
          const sizeDiff = jury(b.id).size - jury(a.id).size;
          if (sizeDiff !== 0) return sizeDiff;
          return a.id.localeCompare(b.id); // déterminisme
        });

      let moved = false;
      for (const donor of donors) {
        const takeable = Array.from(jury(donor.id))
          .filter(
            (memberId) =>
              eligible.has(memberId) &&
              !jury(receiver.id).has(memberId) &&
              !conflictsElsewhere(
                memberId,
                receiver,
                donor.id,
                slots,
                juryBySlot,
                fixedCommitments,
              ),
          )
          .sort(); // déterminisme

        if (takeable.length === 0) continue;
        const memberId = takeable[0];
        jury(donor.id).delete(memberId);
        const receiverJury = juryBySlot.get(receiver.id) || new Set<string>();
        receiverJury.add(memberId);
        juryBySlot.set(receiver.id, receiverJury);
        moves.push({
          memberId,
          fromSlotId: donor.id,
          toSlotId: receiver.id,
        });
        moved = true;
        break;
      }
      if (!moved) break; // plus rien à reprendre pour ce créneau
    }
  }

  return moves;
}
