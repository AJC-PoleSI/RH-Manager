/**
 * generation-inputs — règles PURES qui alimentent le bouton « Générer le
 * Tour N » (cf. tour-generator.ts) : qui est attendu sur une épreuve, et qui
 * peut la tenir.
 *
 * Isolé de la route (app/api/tours/[tour]/generation-inputs) pour être
 * testable sans base : ces deux règles décident du dimensionnement de tout
 * le Tour 3, une erreur ici se voit sur chaque créneau.
 */

import { samePole } from "./auth-poles";

export interface DelibRow {
  candidate_id: string;
  tour1_status?: string | null;
  tour2_status?: string | null;
  tour3_status?: string | null;
}

export interface WishRow {
  candidate_id: string;
  pole: string | null;
}

export interface MemberPoleRow {
  id: string;
  pole: string | null;
}

/**
 * Candidats attendus sur une épreuve :
 *   - admis au tour précédent (au tour 1, tout le monde) et jamais refusés ;
 *   - épreuve de pôle : ayant un vœu pour ce pôle (tout tour confondu). C'est
 *     une ESTIMATION : depuis le 06/10/2026, tout candidat peut s'inscrire à
 *     n'importe quelle épreuve de pôle, vœux ou pas.
 * La comparaison de pôle ignore accents et casse (valeurs saisies à la main).
 */
export function expectedCandidatesFor(o: {
  tour: number;
  isPoleTest: boolean;
  pole: string | null;
  candidateIds: string[];
  deliberations: DelibRow[];
  wishes: WishRow[];
}): string[] {
  const delib = new Map(o.deliberations.map((d) => [d.candidate_id, d]));
  const refused = (d?: DelibRow) =>
    [d?.tour1_status, d?.tour2_status, d?.tour3_status].includes("refused");

  const wishedBy = new Map<string, string[]>();
  for (const w of o.wishes) {
    if (!w.pole) continue;
    const list = wishedBy.get(w.candidate_id) ?? [];
    list.push(w.pole);
    wishedBy.set(w.candidate_id, list);
  }

  return o.candidateIds.filter((id) => {
    const d = delib.get(id);
    if (refused(d)) return false;
    if (o.tour >= 2) {
      const prevKey = `tour${o.tour - 1}_status` as keyof DelibRow;
      if (d?.[prevKey] !== "accepted") return false;
    }
    if (o.isPoleTest && o.pole) {
      return (wishedBy.get(id) ?? []).some((p) => samePole(p, o.pole));
    }
    return true;
  });
}

/**
 * Membres qui PEUVENT tenir une épreuve : ceux du pôle pour une épreuve de
 * pôle, tout le monde sinon. Le super-admin est exclu en amont par l'appelant.
 */
export function eligibleMembersFor(o: {
  isPoleTest: boolean;
  pole: string | null;
  members: MemberPoleRow[];
}): string[] {
  if (o.isPoleTest && o.pole) {
    return o.members.filter((m) => samePole(m.pole, o.pole)).map((m) => m.id);
  }
  return o.members.map((m) => m.id);
}
