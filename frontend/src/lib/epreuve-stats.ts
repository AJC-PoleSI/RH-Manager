// Notes par épreuve sur la page Évaluations (vue admin).
//
// Pour chaque épreuve : la note /20 de chaque candidat et la moyenne de
// l'épreuve. Mêmes règles que la moyenne d'un candidat (averageOn20ByEpreuve) :
//   - une note est d'abord ramenée à /20 selon le barème de l'épreuve ;
//   - les notes de plusieurs examinateurs sur un MÊME candidat sont moyennées
//     entre elles — un candidat vu en binôme ne compte pas double dans la
//     moyenne de l'épreuve ;
//   - une grille vide n'est pas un 0, elle est écartée ; les anciennes notes
//     collectives de business game aussi (filtrées par l'appelant).
//
// Module sans dépendance serveur : il est importé par la page client.

export interface EpreuveScoreInput {
  /** Identifiant de l'épreuve (ou à défaut nom + tour) — sert au regroupement. */
  epreuveKey: string;
  epreuveName: string;
  tour: number | null;
  candidateId: string;
  candidateName: string;
  /** Total obtenu sur la grille. */
  obtained: number;
  /** Total de points de l'épreuve (somme des barèmes de ses critères). */
  maxTotal: number;
}

export interface CandidateEpreuveScore {
  candidateId: string;
  candidateName: string;
  /** Note /20, moyenne des examinateurs, arrondie au dixième. */
  scoreOn20: number;
  /** Nombre de notes moyennées pour ce candidat. */
  evalCount: number;
}

export interface EpreuveStats {
  epreuveKey: string;
  epreuveName: string;
  tour: number | null;
  maxTotal: number;
  /** Moyenne /20 de l'épreuve (un poids par candidat), au dixième. */
  average: number;
  min: number;
  max: number;
  /** Candidats notés, du mieux noté au moins bien noté. */
  candidates: CandidateEpreuveScore[];
  /** Nombre total de notes saisies sur l'épreuve. */
  evalCount: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeEpreuveStats(items: EpreuveScoreInput[]): EpreuveStats[] {
  const byEpreuve = new Map<
    string,
    {
      name: string;
      tour: number | null;
      maxTotal: number;
      byCandidate: Map<string, { name: string; ratios: number[] }>;
    }
  >();

  for (const it of items) {
    const maxTotal = Number(it.maxTotal);
    const obtained = Number(it.obtained);
    if (!Number.isFinite(maxTotal) || maxTotal <= 0) continue;
    if (!Number.isFinite(obtained)) continue;
    let ep = byEpreuve.get(it.epreuveKey);
    if (!ep) {
      ep = { name: it.epreuveName, tour: it.tour, maxTotal, byCandidate: new Map() };
      byEpreuve.set(it.epreuveKey, ep);
    }
    const cand = ep.byCandidate.get(it.candidateId) || { name: it.candidateName, ratios: [] };
    cand.ratios.push(Math.min(1, Math.max(0, obtained / maxTotal)));
    ep.byCandidate.set(it.candidateId, cand);
  }

  const result: EpreuveStats[] = [];
  byEpreuve.forEach((ep, key) => {
    const candidates: CandidateEpreuveScore[] = [];
    let ratioSum = 0;
    let evalCount = 0;
    ep.byCandidate.forEach((c, candidateId) => {
      const ratio = c.ratios.reduce((a, b) => a + b, 0) / c.ratios.length;
      ratioSum += ratio;
      evalCount += c.ratios.length;
      candidates.push({
        candidateId,
        candidateName: c.name,
        scoreOn20: round1(ratio * 20),
        evalCount: c.ratios.length,
      });
    });
    if (candidates.length === 0) return;
    candidates.sort(
      (a, b) => b.scoreOn20 - a.scoreOn20 || a.candidateName.localeCompare(b.candidateName, 'fr'),
    );
    const scores = candidates.map(c => c.scoreOn20);
    result.push({
      epreuveKey: key,
      epreuveName: ep.name,
      tour: ep.tour,
      maxTotal: ep.maxTotal,
      average: round1((ratioSum / candidates.length) * 20),
      min: Math.min(...scores),
      max: Math.max(...scores),
      candidates,
      evalCount,
    });
  });

  // Tour le plus récent d'abord, puis par nom d'épreuve.
  return result.sort(
    (a, b) => (b.tour ?? 0) - (a.tour ?? 0) || a.epreuveName.localeCompare(b.epreuveName, 'fr'),
  );
}
