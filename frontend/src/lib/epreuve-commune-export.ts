import {
  averageOn20ByEpreuve,
  getTotalMaxPoints,
  hasAnyScore,
  sumScores,
} from "@/lib/evaluation-criteria";

/**
 * Colonnes dédiées aux épreuves communes (ex. « CL », cadre légal du Tour 2)
 * dans les exports Excel.
 *
 * Ces épreuves n'ont pas de créneau : leurs notes n'apparaissaient que
 * fondues dans la moyenne du tour (Synthèse) ou en lignes de détail, si bien
 * qu'on ne les retrouvait pas. Un candidat peut en avoir plusieurs (ex. CL
 * corrigé le 05/10 puis une seconde série le 15/10) : on les liste toutes,
 * avec correcteur et date, plus leur moyenne /20.
 */

export interface CommuneEpreuve {
  id: string;
  name: string;
  tour: number;
}

/** Épreuves communes ayant au moins une évaluation, triées par tour puis nom. */
export function collectCommuneEpreuves(candidates: any[]): CommuneEpreuve[] {
  const byId = new Map<string, CommuneEpreuve>();
  candidates.forEach((c) =>
    (c.candidate_evaluations || []).forEach((e: any) => {
      const ep = e.epreuves;
      if (!ep?.id || ep.type !== "commune" || byId.has(ep.id)) return;
      byId.set(ep.id, { id: ep.id, name: (ep.name || "").trim(), tour: ep.tour ?? 0 });
    }),
  );
  return Array.from(byId.values()).sort(
    (a, b) => a.tour - b.tour || a.name.localeCompare(b.name, "fr"),
  );
}

export const communeNotesHeader = (ep: CommuneEpreuve) =>
  `Notes ${ep.name} (Tour ${ep.tour})`;
export const communeAverageHeader = (ep: CommuneEpreuve) =>
  `Moyenne ${ep.name} (/20)`;

const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

/**
 * Notes d'un candidat sur une épreuve commune : une ligne par note
 * « 17,75/20 — Félix Pitz (05/10) », et la moyenne /20 (null si aucune).
 */
export function communeCells(
  candidate: any,
  ep: CommuneEpreuve,
  evaluatorName: (e: any) => string,
): { notes: string; average: number | null } {
  const evals = (candidate.candidate_evaluations || [])
    .filter((e: any) => e.epreuves?.id === ep.id && hasAnyScore(e.scores))
    .sort((a: any, b: any) =>
      String(a.created_at || "").localeCompare(String(b.created_at || "")),
    );

  const notes = evals
    .map((e: any) => {
      const max = getTotalMaxPoints(e.epreuves?.evaluation_questions);
      const who = evaluatorName(e);
      const date = e.created_at
        ? new Date(e.created_at).toLocaleDateString("fr-FR", {
            day: "2-digit",
            month: "2-digit",
          })
        : "";
      const meta = [who, date ? `(${date})` : ""].filter(Boolean).join(" ");
      return `${fmt(sumScores(e.scores))}${max > 0 ? `/${max}` : ""}${meta ? ` — ${meta}` : ""}`;
    })
    .join("\n");

  const average = averageOn20ByEpreuve(
    evals.map((e: any) => ({
      epreuveKey: ep.id,
      obtained: sumScores(e.scores),
      maxTotal: getTotalMaxPoints(e.epreuves?.evaluation_questions),
    })),
  );

  return { notes, average };
}
