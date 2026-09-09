"use client";

/**
 * PAGE DE DÉMONSTRATION — À SUPPRIMER AVANT INTÉGRATION.
 *
 * Sert uniquement à valider le geste de la grille en local, sans authentification
 * et sans le moindre accès à la base. Rien de ce qui est tracé ici n'est envoyé
 * ni enregistré nulle part.
 */

import { useMemo, useState } from "react";
import TimeBandGrid, { type Lane, type Overlay } from "@/components/planning/TimeBandGrid";
import LaneFilter from "@/components/planning/LaneFilter";
import { hhmmToMinutes, minutesToHHMM, type Band } from "@/lib/time-bands";

const ROOMS: Lane[] = [
  { id: "205", label: "205" },
  { id: "217", label: "217" },
  { id: "219", label: "219" },
  { id: "235", label: "235" },
  { id: "238-240", label: "238-240" },
  { id: "242-244", label: "242-244" },
];

function mondayOf(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export default function DemoGrillePage() {
  const [mode, setMode] = useState<"membre" | "admin">("membre");
  const [visibleRooms, setVisibleRooms] = useState<string[]>(ROOMS.map((r) => r.id));
  const [weekOffset, setWeekOffset] = useState(0);
  const [memberBands, setMemberBands] = useState<Band[]>([
    { id: "seed-1", dayIndex: 0, laneId: "", startMin: hhmmToMinutes("08:00"), endMin: hhmmToMinutes("09:55") },
    { id: "seed-2", dayIndex: 0, laneId: "", startMin: hhmmToMinutes("18:10"), endMin: hhmmToMinutes("20:20") },
    { id: "seed-3", dayIndex: 2, laneId: "", startMin: hhmmToMinutes("08:00"), endMin: hhmmToMinutes("14:30") },
  ]);
  const [adminBands, setAdminBands] = useState<Band[]>([
    { id: "seed-a", dayIndex: 1, laneId: "205", startMin: hhmmToMinutes("09:00"), endMin: hhmmToMinutes("12:00") },
    { id: "seed-b", dayIndex: 1, laneId: "217", startMin: hhmmToMinutes("09:00"), endMin: hhmmToMinutes("17:00") },
  ]);

  const days = useMemo(() => {
    const start = mondayOf(new Date());
    start.setDate(start.getDate() + weekOffset * 7);
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekOffset]);

  // Quelques affectations fictives, pour montrer ce que l'examinateur verra
  // par-dessus ses propres bandes.
  const overlays: Overlay[] = [
    { id: "o1", dayIndex: 0, laneId: "", startMin: hhmmToMinutes("08:30"), endMin: hhmmToMinutes("08:55"), label: "Entretien individuel", sublabel: "salle 205", color: "#2563eb" },
    { id: "o2", dayIndex: 0, laneId: "", startMin: hhmmToMinutes("09:00"), endMin: hhmmToMinutes("09:25"), label: "Entretien individuel", sublabel: "salle 205", color: "#2563eb" },
    { id: "o3", dayIndex: 2, laneId: "", startMin: hhmmToMinutes("12:20"), endMin: hhmmToMinutes("13:20"), label: "Business Game", sublabel: "salle 238-240", color: "#7c3aed" },
  ];

  const bands = mode === "membre" ? memberBands : adminBands;
  const setBands = mode === "membre" ? setMemberBands : setAdminBands;

  const shownRooms = ROOMS.filter((r) => visibleRooms.includes(r.id));
  const roomCounts = adminBands.reduce<Record<string, number>>((acc, b) => {
    acc[b.laneId] = (acc[b.laneId] ?? 0) + 1;
    return acc;
  }, {});

  const totalMin = bands.reduce((s, b) => s + (b.endMin - b.startMin), 0);

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <div className="mb-1 flex items-center gap-3">
        <h1 className="text-xl font-bold text-gray-900">
          Grille de saisie par bandes
        </h1>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
          démo locale · rien n&apos;est enregistré
        </span>
      </div>
      <p className="mb-5 text-sm text-gray-600">
        Clique n&apos;importe où et fais glisser vers le bas. Relâche. Puis reclique
        sur la bande bleue pour l&apos;ajuster au quart d&apos;heure près.
        <kbd className="mx-1 rounded border border-gray-300 bg-gray-50 px-1 text-[11px]">Échap</kbd>
        annule le geste en cours.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5">
          {(["membre", "admin"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                mode === m ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {m === "membre" ? "Examinateur — mes dispos" : "Admin — ouvertures de salles"}
            </button>
          ))}
        </div>

        <div className="inline-flex items-center gap-1">
          <button onClick={() => setWeekOffset((w) => w - 1)} className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm hover:bg-gray-50">←</button>
          <span className="px-2 text-sm text-gray-600">
            semaine du {days[0].toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
          </span>
          <button onClick={() => setWeekOffset((w) => w + 1)} className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm hover:bg-gray-50">→</button>
        </div>

        <span className="ml-auto text-sm text-gray-600">
          {bands.length} bande{bands.length > 1 ? "s" : ""} ·{" "}
          {Math.floor(totalMin / 60)}h{String(totalMin % 60).padStart(2, "0")} au total
        </span>
      </div>

      {mode === "admin" && (
        <div className="mb-3">
          <LaneFilter
            lanes={ROOMS}
            visible={visibleRooms}
            onChange={setVisibleRooms}
            counts={roomCounts}
          />
        </div>
      )}

      <TimeBandGrid
        days={days}
        lanes={mode === "admin" ? shownRooms : undefined}
        bands={bands}
        overlays={mode === "membre" ? overlays : []}
        onChange={setBands}
        // Plus il y a de salles côté à côté, plus les colonnes sont étroites :
        // on rend la grille un peu moins haute pour compenser visuellement.
        pxPerMin={mode === "admin" && shownRooms.length > 2 ? 0.75 : 0.9}
      />

      <details className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <summary className="cursor-pointer text-sm font-medium text-gray-700">
          Ce qui serait envoyé au serveur
        </summary>
        <pre className="mt-2 overflow-auto text-xs text-gray-600">
{JSON.stringify(
  bands.map((b) => ({
    jour: days[b.dayIndex]?.toLocaleDateString("fr-FR"),
    salle: b.laneId || undefined,
    debut: minutesToHHMM(b.startMin),
    fin: minutesToHHMM(b.endMin),
  })),
  null,
  2,
)}
        </pre>
      </details>
    </div>
  );
}
