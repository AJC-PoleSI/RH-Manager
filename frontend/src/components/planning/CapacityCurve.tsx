"use client";

/**
 * CapacityCurve — combien de salles l'effectif présent permet-il de tenir ?
 *
 * Onglet « C » replié sur le bord de la grille d'ouvertures. Réservé à
 * l'admin : c'est un outil de dimensionnement, pas une information destinée
 * aux examinateurs.
 *
 * Ce qu'il répond : l'estimateur dit combien de créneaux il faut pour les
 * candidats, mais rien sur le personnel. Un admin peut ouvrir cinq salles à
 * 10h alors que trois examinateurs seulement sont là — le dispatch fabrique
 * alors des créneaux que personne ne tiendra. La courbe montre le plafond
 * réel, heure par heure, AVANT de tracer les ouvertures.
 *
 * Spec : docs/superpowers/specs/2026-09-09-refonte-creneaux-bandes-design.md
 */

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  computeCapacity,
  CAPACITY_STEP_MIN,
  type AvailabilityWindow,
  type CapacityMode,
} from "@/lib/room-capacity";
import { minutesToHHMM, GRID_START_MIN } from "@/lib/time-bands";
import { cn } from "@/lib/utils";

export interface CapacityDay {
  label: string;
  /** Fenêtres de dispo des examinateurs pour ce jour. */
  windows: AvailabilityWindow[];
  /** Salles réellement ouvertes ce jour-là, pour confronter au plafond. */
  roomsOpened?: number;
}

interface Props {
  days: CapacityDay[];
  totalRooms: number;
  evaluatorsPerGroupRoom: number;
  evaluatorsPerIndividualRoom: number;
}

const MODE_STYLE: Record<CapacityMode, { bar: string; dot: string; label: string }> = {
  groupe: { bar: "bg-emerald-500", dot: "bg-emerald-500", label: "collectif" },
  individuel: { bar: "bg-amber-400", dot: "bg-amber-400", label: "individuel" },
  aucun: { bar: "bg-gray-200", dot: "bg-gray-300", label: "aucune salle" },
};

export default function CapacityCurve({
  days,
  totalRooms,
  evaluatorsPerGroupRoom,
  evaluatorsPerIndividualRoom,
}: Props) {
  const [open, setOpen] = useState(false);
  const [dayIndex, setDayIndex] = useState(0);

  const day = days[Math.min(dayIndex, days.length - 1)];
  const dayLabel = day?.label ?? "";
  const roomsOpened = day?.roomsOpened;

  const report = useMemo(
    () =>
      computeCapacity({
        windows: day?.windows ?? [],
        totalRooms,
        evaluatorsPerGroupRoom,
        evaluatorsPerIndividualRoom,
      }),
    [day, totalRooms, evaluatorsPerGroupRoom, evaluatorsPerIndividualRoom],
  );

  // La languette s'allume dès qu'UN jour de la semaine est sur-ouvert : il ne
  // faut pas avoir à ouvrir chaque jour pour découvrir le problème.
  const weekHasOverOpening = useMemo(
    () =>
      days.some((d) => {
        if (d.roomsOpened === undefined) return false;
        const r = computeCapacity({
          windows: d.windows,
          totalRooms,
          evaluatorsPerGroupRoom,
          evaluatorsPerIndividualRoom,
        });
        return r.slices.some((s) => d.roomsOpened! > s.rooms && s.available > 0);
      }),
    [days, totalRooms, evaluatorsPerGroupRoom, evaluatorsPerIndividualRoom],
  );

  // Échelle verticale : le pic d'effectif, avec un minimum pour qu'une journée
  // creuse ne produise pas des barres démesurées.
  const scale = Math.max(report.peak, 4);

  // Tranches où l'admin a ouvert plus de salles que l'effectif n'en permet.
  const overOpened =
    roomsOpened !== undefined
      ? report.slices.filter((s) => roomsOpened > s.rooms && s.available > 0).length
      : 0;

  return (
    <div className="relative">
      {/* Languette repliée */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Capacité en examinateurs — combien de salles peut-on tenir ?"
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg border text-sm font-bold transition-colors",
          open
            ? "border-gray-900 bg-gray-900 text-white"
            : weekHasOverOpening
              ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
              : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50",
        )}
      >
        {open ? <ChevronRight className="h-4 w-4" /> : "C"}
      </button>

      {open && (
        <div className="absolute left-0 top-10 z-40 w-[520px] rounded-xl border border-gray-200 bg-white p-4 shadow-[0_12px_32px_-8px_rgba(15,23,42,0.28)]">
          <div className="mb-2 flex flex-wrap items-center gap-1">
            {days.map((d, i) => (
              <button
                key={d.label + i}
                type="button"
                onClick={() => setDayIndex(i)}
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                  i === dayIndex
                    ? "bg-gray-900 text-white"
                    : "text-gray-500 hover:bg-gray-50",
                )}
              >
                {d.label}
              </button>
            ))}
          </div>

          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h4 className="text-sm font-semibold text-gray-900">
              Effectif examinateurs — {dayLabel}
            </h4>
            <span className="text-xs text-gray-400">
              pic {report.peak} · {totalRooms} salle{totalRooms > 1 ? "s" : ""}
            </span>
          </div>
          <p className="mb-3 text-xs text-gray-500">
            {evaluatorsPerGroupRoom} examinateurs par salle en collectif,{" "}
            {evaluatorsPerIndividualRoom} en individuel. La hauteur montre les
            présents, la couleur ce que cet effectif permet.
          </p>

          {report.peak === 0 ? (
            <p className="rounded-lg bg-gray-50 px-3 py-4 text-center text-sm text-gray-500">
              Aucun examinateur n&apos;a déclaré de disponibilité ce jour-là.
            </p>
          ) : (
            <>
              {/* Histogramme */}
              <div className="flex h-28 items-end gap-px">
                {report.slices.map((s) => {
                  const style = MODE_STYLE[s.mode];
                  return (
                    <div
                      key={s.startMin}
                      className="group/bar relative flex-1"
                      title={`${minutesToHHMM(s.startMin)}–${minutesToHHMM(s.startMin + CAPACITY_STEP_MIN)} · ${s.available} examinateur(s) · ${s.rooms} salle(s) en ${style.label}`}
                    >
                      <div
                        className={cn("w-full rounded-sm transition-colors", style.bar)}
                        style={{
                          height: `${Math.max(2, (s.available / scale) * 112)}px`,
                        }}
                      />
                      {/* Nombre de salles tenables, sous la barre */}
                      <span className="absolute -bottom-4 left-0 right-0 text-center text-[9px] tabular-nums text-gray-400">
                        {s.rooms > 0 ? s.rooms : ""}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Graduation horaire */}
              <div className="mt-5 flex justify-between text-[10px] tabular-nums text-gray-400">
                {[8, 11, 14, 17, 20].map((h) => (
                  <span key={h}>{String(h).padStart(2, "0")}h</span>
                ))}
              </div>

              {/* Légende */}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-100 pt-2 text-[11px] text-gray-500">
                {(["groupe", "individuel", "aucun"] as CapacityMode[]).map((m) => (
                  <span key={m} className="flex items-center gap-1.5">
                    <span className={cn("h-2 w-2 rounded-sm", MODE_STYLE[m].dot)} />
                    {MODE_STYLE[m].label}
                  </span>
                ))}
                <span className="ml-auto text-gray-400">
                  au mieux {report.maxRooms} salle{report.maxRooms > 1 ? "s" : ""}
                </span>
              </div>

              {overOpened > 0 && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Vous avez ouvert <strong>{roomsOpened}</strong> salle
                  {roomsOpened! > 1 ? "s" : ""} ce jour-là, mais l&apos;effectif
                  n&apos;en permet pas autant sur{" "}
                  <strong>{overOpened}</strong> tranche
                  {overOpened > 1 ? "s" : ""} horaire{overOpened > 1 ? "s" : ""}.
                  Les créneaux correspondants resteront sans examinateur.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
