import {
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
 * qu'on ne les retrouvait pas. Chaque épreuve commune (CL, CL 2…) a ses deux
 * colonnes ; si un candidat a plusieurs notes sur la même, on les liste
 * toutes, avec correcteur et date, plus leur moyenne /20.
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

  // Moyenne /20 au centième : averageOn20ByEpreuve arrondit au dixième,
  // ce qui affichait 17,3 pour une note unique de 17,25.
  const on20 = evals
    .map((e: any) => {
      const max = getTotalMaxPoints(e.epreuves?.evaluation_questions);
      return max > 0 ? (Math.min(sumScores(e.scores), max) / max) * 20 : null;
    })
    .filter((n: number | null): n is number => n !== null);
  const average = on20.length
    ? Math.round((on20.reduce((a: number, b: number) => a + b, 0) / on20.length) * 100) / 100
    : null;

  return { notes, average };
}
