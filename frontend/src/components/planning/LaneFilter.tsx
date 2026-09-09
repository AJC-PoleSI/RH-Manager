"use client";

/**
 * LaneFilter — choix des salles affichées dans la grille.
 *
 * Six salles sur cinq jours font trente colonnes de ~24 px : ça tient, mais
 * tracer y devient chirurgical. Cocher une salle l'isole et rend les colonnes
 * six fois plus larges.
 *
 * Interaction : un clic sur une salle l'affiche SEULE — c'est le geste qu'on
 * fait le plus, il ne doit pas coûter cinq décochages. Recliquer dessus, ou
 * cliquer « Toutes », rétablit la vue d'ensemble. Les deux seuls états utiles
 * sont « tout » et « une seule » ; on ne construit pas de sous-ensemble
 * arbitraire tant que personne n'en a besoin.
 *
 * Le filtre est purement visuel : les bandes des salles masquées restent en
 * mémoire et repartent intactes à l'enregistrement.
 */

import { cn } from "@/lib/utils";
import type { Lane } from "./TimeBandGrid";

interface Props {
  lanes: Lane[];
  /** Salles visibles. Un ensemble vide n'est jamais produit par ce composant. */
  visible: string[];
  onChange: (visible: string[]) => void;
  /** Nombre de bandes par salle, affiché en pastille. */
  counts?: Record<string, number>;
}

export default function LaneFilter({ lanes, visible, onChange, counts }: Props) {
  const allVisible = visible.length === lanes.length;

  const isolate = (id: string) => {
    const alone = visible.length === 1 && visible[0] === id;
    onChange(alone ? lanes.map((l) => l.id) : [id]);
  };

  const chip =
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 text-xs text-gray-400">Salles</span>

      <button
        type="button"
        onClick={() => onChange(lanes.map((l) => l.id))}
        className={cn(
          chip,
          allVisible
            ? "border-gray-900 bg-gray-900 text-white"
            : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
        )}
      >
        Toutes
      </button>

      {lanes.map((lane) => {
        const on = visible.includes(lane.id);
        const solo = visible.length === 1 && visible[0] === lane.id;
        const n = counts?.[lane.id] ?? 0;
        return (
          <button
            key={lane.id}
            type="button"
            onClick={() => isolate(lane.id)}
            aria-pressed={on && visible.length === 1}
            title={
              visible.length === 1 && visible[0] === lane.id
                ? "Revenir à toutes les salles"
                : `Afficher seulement la salle ${lane.label ?? lane.id}`
            }
            className={cn(
              chip,
              solo
                ? "border-blue-600 bg-blue-600 text-white"
                : on
                  ? "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                  : "border-gray-200 bg-white text-gray-400 hover:bg-gray-50",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                solo ? "bg-white" : n > 0 ? "bg-blue-500" : "bg-gray-300",
              )}
            />
            {lane.label ?? lane.id}
            {n > 0 && (
              <span
                className={cn(
                  "rounded-full px-1 text-[10px] tabular-nums",
                  solo ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-500",
                )}
              >
                {n}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
