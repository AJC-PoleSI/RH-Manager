"use client";

/**
 * TimeBandGrid — grille horaire 8h00→20h30 où l'on trace des bandes au
 * glissement plutôt que de cocher des cases.
 *
 * Le composant ne connaît ni salle, ni épreuve, ni API : il reçoit `bands`,
 * il renvoie `bands`. Toute la logique horaire vit dans lib/time-bands.ts.
 *
 * Fluidité — les trois choix qui comptent :
 *   1. Pointer Events + setPointerCapture : le geste ne décroche pas si le
 *      curseur sort de la colonne, et le tactile marche sans code en plus.
 *   2. Aucun setState pendant le glissement. La bande fantôme et l'étiquette
 *      sont pilotées directement en DOM dans un requestAnimationFrame ;
 *      React ne re-render qu'au relâchement.
 *   3. touch-action: none sur les pistes, pour que le doigt trace au lieu de
 *      faire défiler la page.
 *
 * Spec : docs/superpowers/specs/2026-09-09-refonte-creneaux-bandes-design.md
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GRID_START_MIN,
  GRID_END_MIN,
  GRID_SPAN_MIN,
  SNAP_DRAG,
  SNAP_EDIT,
  MIN_BAND_MIN,
  minutesToHHMM,
  formatDuration,
  snap,
  clampToGrid,
  ratioToMin,
  normalizeBands,
  type Band,
} from "@/lib/time-bands";
import { cn } from "@/lib/utils";

export interface Lane {
  id: string;
  label?: string;
}

/** Bloc en lecture seule superposé aux bandes (une affectation, par exemple). */
export interface Overlay {
  id: string;
  dayIndex: number;
  laneId: string;
  startMin: number;
  endMin: number;
  label: string;
  sublabel?: string;
  color?: string;
}

interface Props {
  days: Date[];
  lanes?: Lane[];
  bands: Band[];
  overlays?: Overlay[];
  onChange?: (bands: Band[]) => void;
  readOnly?: boolean;
  pxPerMin?: number;
}

type DragMode = "create" | "resize-start" | "resize-end";

interface DragState {
  pointerId: number;
  mode: DragMode;
  dayIndex: number;
  laneId: string;
  /** Extrémité fixe du geste, en minutes. */
  anchorMin: number;
  cursorMin: number;
  /** Piste visée, en coordonnées du conteneur. */
  box: { left: number; top: number; width: number; height: number };
  /** Bande redimensionnée, le cas échéant. */
  bandId?: string;
  moved: boolean;
}

const SINGLE_LANE: Lane[] = [{ id: "" }];
const DAY_LABELS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

let bandSeq = 0;
const nextBandId = () => `band-${Date.now().toString(36)}-${bandSeq++}`;


/**
 * Sélecteur d'heure au pas de 5 minutes.
 *
 * On n'utilise PAS <input type="time"> : son format suit la locale du
 * NAVIGATEUR, pas celle du document. Un membre dont le navigateur est en
 * anglais verrait « 04:15 PM » au milieu d'une interface française. Deux
 * <select> donnent un affichage 24h identique partout, et se manipulent mieux
 * au doigt.
 */
function TimeSelect({
  valueMin,
  onChange,
}: {
  valueMin: number;
  onChange: (min: number) => void;
}) {
  const h = Math.floor(valueMin / 60);
  const m = valueMin % 60;
  const hours: number[] = [];
  for (let x = Math.floor(GRID_START_MIN / 60); x <= Math.floor(GRID_END_MIN / 60); x++) {
    hours.push(x);
  }
  const minutes: number[] = [];
  for (let x = 0; x < 60; x += SNAP_EDIT) minutes.push(x);

  const cls =
    "rounded border border-gray-300 bg-white px-1 py-1 text-sm tabular-nums focus:border-blue-500 focus:outline-none";

  return (
    <span className="inline-flex items-center gap-0.5">
      <select
        className={cls}
        value={h}
        onChange={(e) => onChange(clampToGrid(Number(e.target.value) * 60 + m))}
      >
        {hours.map((x) => (
          <option key={x} value={x}>
            {String(x).padStart(2, "0")}
          </option>
        ))}
      </select>
      <span className="text-gray-400">:</span>
      <select
        className={cls}
        value={m}
        onChange={(e) => onChange(clampToGrid(h * 60 + Number(e.target.value)))}
      >
        {minutes.map((x) => (
          <option key={x} value={x}>
            {String(x).padStart(2, "0")}
          </option>
        ))}
      </select>
    </span>
  );
}

export default function TimeBandGrid({
  days,
  lanes = SINGLE_LANE,
  bands,
  overlays = [],
  onChange,
  readOnly = false,
  pxPerMin = 0.9,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  /** Repère de survol : montre où le tracé commencerait, avant même de cliquer. */
  const hoverRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const rafRef = useRef<number | null>(null);

  const [gridWidth, setGridWidth] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Piste de la bande sélectionnée, pour ancrer le panneau de réglage. */
  const [selectedBox, setSelectedBox] = useState<DragState["box"] | null>(null);

  const height = Math.round(GRID_SPAN_MIN * pxPerMin);

  // Le popover de réglage bascule à gauche quand il n'y a plus la place à droite.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setGridWidth(el.clientWidth));
    ro.observe(el);
    setGridWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const editable = !readOnly && Boolean(onChange);

  // Traits horaires : pleins à l'heure, discrets à la demi-heure.
  const hourLines = useMemo(() => {
    const out: { min: number; label: string; major: boolean }[] = [];
    for (let m = GRID_START_MIN; m <= GRID_END_MIN; m += 30) {
      out.push({ min: m, label: minutesToHHMM(m), major: m % 60 === 0 });
    }
    return out;
  }, []);

  const topOf = useCallback(
    (min: number) => (min - GRID_START_MIN) * pxPerMin,
    [pxPerMin],
  );
  const heightOf = useCallback(
    (a: number, b: number) => Math.max(2, (b - a) * pxPerMin),
    [pxPerMin],
  );

  // ─── Rendu direct du geste (hors React) ────────────────────────────

  const paintDrag = useCallback(() => {
    rafRef.current = null;
    const d = dragRef.current;
    const ghost = ghostRef.current;
    const label = labelRef.current;
    if (!d || !ghost || !label) return;

    const start = Math.min(d.anchorMin, d.cursorMin);
    const end = Math.max(d.anchorMin, d.cursorMin);

    ghost.style.display = "block";
    ghost.style.left = `${d.box.left}px`;
    ghost.style.width = `${d.box.width}px`;
    ghost.style.top = `${d.box.top + topOf(start)}px`;
    ghost.style.height = `${heightOf(start, end)}px`;

    label.style.display = "block";
    label.style.transform = `translate(${d.box.left + d.box.width / 2}px, ${
      d.box.top + topOf(end) + 8
    }px) translateX(-50%)`;
    label.textContent =
      end - start < MIN_BAND_MIN
        ? minutesToHHMM(d.cursorMin)
        : `${minutesToHHMM(start)} → ${minutesToHHMM(end)} · ${formatDuration(end - start)}`;
  }, [topOf, heightOf]);

  const schedulePaint = useCallback(() => {
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(paintDrag);
    }
  }, [paintDrag]);

  /** Repère de survol — masqué dès qu'un geste commence. */
  const paintHover = useCallback(
    (clientY: number, laneEl: HTMLElement) => {
      const el = hoverRef.current;
      if (!el || dragRef.current) return;
      const box = boxOfRef.current(laneEl);
      const r = laneEl.getBoundingClientRect();
      const min = clampToGrid(
        snap(ratioToMin((clientY - r.top) / r.height), SNAP_DRAG),
      );
      el.style.display = "block";
      el.style.left = `${box.left}px`;
      el.style.width = `${box.width}px`;
      el.style.top = `${box.top + topOf(min)}px`;
      const chip = el.firstElementChild as HTMLElement | null;
      if (chip) chip.textContent = minutesToHHMM(min);
    },
    [topOf],
  );

  const hideHover = useCallback(() => {
    if (hoverRef.current) hoverRef.current.style.display = "none";
  }, []);

  const hideDragChrome = useCallback(() => {
    hideHover();
    if (ghostRef.current) ghostRef.current.style.display = "none";
    if (labelRef.current) labelRef.current.style.display = "none";
  }, [hideHover]);

  /** Minute visée par le curseur dans une piste donnée. */
  const minuteAt = useCallback(
    (clientY: number, laneEl: HTMLElement, step: number) => {
      const r = laneEl.getBoundingClientRect();
      return clampToGrid(snap(ratioToMin((clientY - r.top) / r.height), step));
    },
    [],
  );

  /** Position d'une piste dans le repère du conteneur. */
  const boxOfRef = useRef<(el: HTMLElement) => DragState["box"]>(() => ({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  }));
  const boxOf = useCallback((laneEl: HTMLElement) => {
    const lr = laneEl.getBoundingClientRect();
    const cr = containerRef.current!.getBoundingClientRect();
    return {
      left: lr.left - cr.left,
      top: lr.top - cr.top,
      width: lr.width,
      height: lr.height,
    };
  }, []);
  boxOfRef.current = boxOf;

  // ─── Démarrage d'un geste ──────────────────────────────────────────

  const beginDrag = useCallback(
    (
      e: React.PointerEvent,
      laneEl: HTMLElement,
      dayIndex: number,
      laneId: string,
      mode: DragMode,
      bandId?: string,
      anchorMin?: number,
    ) => {
      if (!editable) return;
      e.preventDefault();
      e.stopPropagation();
      const cursorMin = minuteAt(e.clientY, laneEl, SNAP_DRAG);
      dragRef.current = {
        pointerId: e.pointerId,
        mode,
        dayIndex,
        laneId,
        anchorMin: anchorMin ?? cursorMin,
        cursorMin,
        box: boxOf(laneEl),
        bandId,
        moved: false,
      };
      // On capture sur la PISTE, pas sur e.target : la cible peut être une
      // poignée qui disparaît au premier re-render, ce qui perdrait la capture.
      // setPointerCapture lève si le pointeur n'est plus actif (geste annulé
      // par le système, pointeur synthétique) — le geste continue très bien
      // sans capture puisqu'on écoute au niveau du document.
      try {
        laneEl.setPointerCapture?.(e.pointerId);
      } catch {
        /* capture indisponible : les écouteurs document prennent le relais */
      }
      schedulePaint();
    },
    [editable, minuteAt, boxOf, schedulePaint],
  );

  const onLanePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, dayIndex: number, laneId: string) => {
      if (e.button !== 0) return;
      setSelectedId(null);
      setSelectedBox(boxOf(e.currentTarget));
      beginDrag(e, e.currentTarget, dayIndex, laneId, "create");
    },
    [beginDrag, boxOf],
  );

  // ─── Suivi et fin du geste (au niveau document) ────────────────────

  useEffect(() => {
    if (!editable) return;

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const cr = containerRef.current?.getBoundingClientRect();
      if (!cr) return;
      const ratio = (e.clientY - cr.top - d.box.top) / d.box.height;
      const next = clampToGrid(snap(ratioToMin(ratio), SNAP_DRAG));
      if (next !== d.cursorMin) {
        d.cursorMin = next;
        d.moved = true;
        schedulePaint();
      }
    };

    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      dragRef.current = null;
      hideDragChrome();

      const start = Math.min(d.anchorMin, d.cursorMin);
      const end = Math.max(d.anchorMin, d.cursorMin);

      // Geste trop court sur une piste vide : c'est un clic, pas un tracé.
      if (end - start < MIN_BAND_MIN) {
        if (d.mode !== "create" && d.bandId) setSelectedId(d.bandId);
        return;
      }

      if (d.mode === "create") {
        const created: Band = {
          id: nextBandId(),
          dayIndex: d.dayIndex,
          laneId: d.laneId,
          startMin: start,
          endMin: end,
        };
        const next = normalizeBands([...bands, created]);
        onChange?.(next);
        // La bande créée a pu fusionner avec une voisine : on sélectionne
        // celle qui contient réellement le geste.
        const landed = next.find(
          (b) =>
            b.dayIndex === created.dayIndex &&
            b.laneId === created.laneId &&
            b.startMin <= start &&
            b.endMin >= end,
        );
        setSelectedId(landed?.id ?? created.id);
      } else if (d.bandId) {
        const next = normalizeBands(
          bands.map((b) =>
            b.id === d.bandId ? { ...b, startMin: start, endMin: end } : b,
          ),
        );
        onChange?.(next);
        setSelectedId(
          next.find((b) => b.startMin <= start && b.endMin >= end && b.dayIndex === d.dayIndex && b.laneId === d.laneId)?.id ?? null,
        );
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (dragRef.current) {
        dragRef.current = null;
        hideDragChrome();
      } else {
        setSelectedId(null);
        setSelectedBox(null);
      }
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      document.removeEventListener("keydown", onKey);
    };
  }, [editable, bands, onChange, schedulePaint, hideDragChrome]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // ─── Édition fine ──────────────────────────────────────────────────

  const updateBand = useCallback(
    (id: string, patch: Partial<Pick<Band, "startMin" | "endMin">>) => {
      const next = normalizeBands(
        bands.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      );
      onChange?.(next);
      if (!next.some((b) => b.id === id)) setSelectedId(null);
    },
    [bands, onChange],
  );

  const removeBand = useCallback(
    (id: string) => {
      onChange?.(bands.filter((b) => b.id !== id));
      setSelectedId(null);
    },
    [bands, onChange],
  );

  const selected = bands.find((b) => b.id === selectedId) ?? null;

  // ─── Rendu ─────────────────────────────────────────────────────────

  const laneList = lanes.length ? lanes : SINGLE_LANE;
  const showLaneLabels = laneList.length > 1;

  // Repères de lecture : la journée en cours, et celles déjà passées — on ne
  // peut pas se déclarer disponible hier.
  const todayKey = new Date().toDateString();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dayFlags = days.map((d) => ({
    isToday: d.toDateString() === todayKey,
    isPast: d.getTime() < startOfToday.getTime(),
  }));

  return (
    <div
      ref={containerRef}
      className="relative select-none"
      onPointerDown={(e) => {
        // Clic dans le vide (hors piste, hors bande) : on désélectionne.
        if (e.target === e.currentTarget) setSelectedId(null);
      }}
    >
      <div
        className="grid gap-px rounded-lg border border-gray-200 bg-gray-200 overflow-hidden"
        style={{
          gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))`,
        }}
      >
        {/* Coin haut-gauche */}
        <div className="bg-gray-50/80" style={{ height: 48 }} />

        {/* En-têtes de journée */}
        {days.map((d, i) => (
          <div
            key={`head-${i}`}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5",
              dayFlags[i].isToday ? "bg-blue-50/70" : "bg-gray-50/80",
            )}
            style={{ height: 48 }}
          >
            <span
              className={cn(
                "text-[10px] font-medium uppercase tracking-[0.08em]",
                dayFlags[i].isToday
                  ? "text-blue-600"
                  : dayFlags[i].isPast
                    ? "text-gray-300"
                    : "text-gray-400",
              )}
            >
              {DAY_LABELS[(d.getDay() + 6) % 7]}
            </span>
            <span
              className={cn(
                "text-[15px] font-semibold leading-none tabular-nums",
                dayFlags[i].isToday
                  ? "flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white"
                  : dayFlags[i].isPast
                    ? "text-gray-300"
                    : "text-gray-800",
              )}
            >
              {d.getDate()}
            </span>
          </div>
        ))}

        {/* Ligne des salles — hors des pistes, pour qu'une bande ne la recouvre pas */}
        {showLaneLabels && (
          <>
            <div className="bg-gray-50" style={{ height: 20 }} />
            {days.map((_, i) => (
              <div key={`lanes-${i}`} className="flex bg-gray-50" style={{ height: 20 }}>
                {laneList.map((lane) => (
                  <div
                    key={lane.id}
                    className="flex-1 min-w-0 truncate border-l border-gray-100 px-0.5 text-center text-[9px] leading-5 text-gray-500 first:border-l-0"
                    title={lane.label ?? lane.id}
                  >
                    {lane.label ?? lane.id}
                  </div>
                ))}
              </div>
            ))}
          </>
        )}

        {/* Colonne des heures */}
        <div className="relative bg-gray-50/80" style={{ height }}>
          {hourLines.map((l) =>
            l.major ? (
              <span
                key={l.min}
                className={cn(
                  "absolute right-2 -translate-y-1/2 text-[10px] tabular-nums",
                  l.min === 12 * 60
                    ? "font-medium text-gray-500"
                    : "text-gray-400",
                )}
                style={{ top: topOf(l.min) }}
              >
                {l.label}
              </span>
            ) : null,
          )}
        </div>

        {/* Journées */}
        {days.map((_, dayIndex) => (
          <div
            key={`col-${dayIndex}`}
            className={cn(
              "relative flex",
              dayFlags[dayIndex].isToday
                ? "bg-blue-50/25"
                : dayFlags[dayIndex].isPast
                  ? "bg-gray-50/60"
                  : "bg-white",
            )}
            style={{ height }}
          >
            {laneList.map((lane, laneIndex) => (
              <div
                key={lane.id || "solo"}
                data-lane
                className={cn(
                  "group/lane relative flex-1 min-w-0 border-l border-gray-100 first:border-l-0",
                  // En multi-salles les pistes sont étroites : une alternance
                  // très légère suffit à les distinguer sans faire du zèbre.
                  showLaneLabels && laneIndex % 2 === 1 && "bg-gray-50/40",
                  editable && "cursor-crosshair",
                )}
                style={{ touchAction: "none" }}
                onPointerDown={(e) => onLanePointerDown(e, dayIndex, lane.id)}
                onPointerMove={(e) => {
                  if (editable) paintHover(e.clientY, e.currentTarget);
                }}
                onPointerLeave={hideHover}
              >
                {/* Traits horaires */}
                {hourLines.map((l) => (
                  <div
                    key={l.min}
                    className={cn(
                      "pointer-events-none absolute inset-x-0 border-t",
                      l.major ? "border-gray-200/90" : "border-gray-100/70",
                    )}
                    style={{ top: topOf(l.min) }}
                  />
                ))}

                {/* Affectations, en lecture seule, derrière les bandes */}
                {overlays
                  .filter((o) => o.dayIndex === dayIndex && o.laneId === lane.id)
                  .map((o) => (
                    <div
                      key={o.id}
                      className="pointer-events-none absolute left-3 right-[3px] z-20 overflow-hidden rounded-[4px] border border-gray-200/80 border-l-[3px] bg-white px-1.5 py-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                      style={{
                        top: topOf(o.startMin),
                        height: heightOf(o.startMin, o.endMin),
                        borderLeftColor: o.color ?? "#64748b",
                      }}
                      title={`${minutesToHHMM(o.startMin)}–${minutesToHHMM(o.endMin)} · ${o.label}${o.sublabel ? ` · ${o.sublabel}` : ""}`}
                    >
                      <div className="truncate text-[10px] font-semibold leading-tight text-gray-800">
                        {o.label}
                      </div>
                      {o.sublabel && o.endMin - o.startMin >= 30 && (
                        <div className="truncate text-[10px] leading-tight text-gray-500">
                          {o.sublabel}
                        </div>
                      )}
                    </div>
                  ))}

                {/* Bandes de disponibilité */}
                {bands
                  .filter((b) => b.dayIndex === dayIndex && b.laneId === lane.id)
                  .map((b) => {
                    const isSel = b.id === selectedId;
                    return (
                      <div
                        key={b.id}
                        className={cn(
                          "absolute inset-x-[3px] overflow-hidden rounded-[5px]",
                          "bg-gradient-to-b from-blue-500 to-blue-600",
                          "shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]",
                          "transition-[box-shadow,filter] duration-150",
                          isSel
                            ? "z-10 shadow-[0_0_0_2px_#1d4ed8,0_6px_16px_-4px_rgba(29,78,216,0.5)]"
                            : "hover:brightness-105 hover:shadow-[0_2px_8px_-2px_rgba(29,78,216,0.45)]",
                          editable ? "cursor-pointer" : "cursor-default",
                        )}
                        style={{
                          top: topOf(b.startMin),
                          height: heightOf(b.startMin, b.endMin),
                          touchAction: "none",
                        }}
                        onPointerDown={(e) => {
                          if (!editable) return;
                          e.stopPropagation();
                          const laneEl = (e.currentTarget as HTMLElement).closest(
                            "[data-lane]",
                          ) as HTMLElement | null;
                          if (laneEl) setSelectedBox(boxOf(laneEl));
                          setSelectedId(b.id);
                        }}
                      >
                        <div className="px-1.5 pt-1 text-[10px] font-semibold leading-none tabular-nums text-white">
                          {minutesToHHMM(b.startMin)}
                        </div>
                        {b.endMin - b.startMin >= 50 && (
                          <div className="absolute inset-x-0 bottom-0 px-1.5 pb-1 text-[10px] leading-none tabular-nums text-white/75">
                            {minutesToHHMM(b.endMin)}
                          </div>
                        )}

                      </div>
                    );
                  })}

                {/* Poignées de la bande sélectionnée — sœurs des bandes, donc
                    au-dessus des affectations et toujours attrapables. */}
                {editable &&
                  bands
                    .filter(
                      (b) =>
                        b.id === selectedId &&
                        b.dayIndex === dayIndex &&
                        b.laneId === lane.id,
                    )
                    .map((b) => (
                      <div key={`h-${b.id}`}>
                        <div
                          className="absolute inset-x-0 z-30 flex h-3.5 cursor-ns-resize items-center"
                          style={{ top: topOf(b.startMin) - 7, touchAction: "none" }}
                          onPointerDown={(e) => {
                            const laneEl = (e.currentTarget as HTMLElement).closest(
                              "[data-lane]",
                            ) as HTMLElement;
                            beginDrag(e, laneEl, dayIndex, lane.id, "resize-start", b.id, b.endMin);
                          }}
                        >
                          <div className="mx-auto h-[3px] w-7 rounded-full bg-white shadow ring-1 ring-blue-700/30" />
                        </div>
                        <div
                          className="absolute inset-x-0 z-30 flex h-3.5 cursor-ns-resize items-center"
                          style={{ top: topOf(b.endMin) - 7, touchAction: "none" }}
                          onPointerDown={(e) => {
                            const laneEl = (e.currentTarget as HTMLElement).closest(
                              "[data-lane]",
                            ) as HTMLElement;
                            beginDrag(e, laneEl, dayIndex, lane.id, "resize-end", b.id, b.startMin);
                          }}
                        >
                          <div className="mx-auto h-[3px] w-7 rounded-full bg-white shadow ring-1 ring-blue-700/30" />
                        </div>
                      </div>
                    ))}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Repère de survol : où commencerait le tracé */}
      <div
        ref={hoverRef}
        className="pointer-events-none absolute z-10 hidden"
        style={{ display: "none" }}
      >
        <span className="absolute -top-2 left-1 rounded bg-gray-900/85 px-1 py-px text-[9px] font-medium tabular-nums leading-tight text-white" />
        <div className="h-px w-full bg-blue-400/70" />
      </div>

      {/* Bande fantôme du geste en cours */}
      <div
        ref={ghostRef}
        className="pointer-events-none absolute z-40 hidden rounded-[5px] border-2 border-dashed border-blue-600 bg-blue-500/25"
        style={{ display: "none" }}
      />

      {/* Étiquette qui suit le curseur */}
      <div
        ref={labelRef}
        className="pointer-events-none absolute left-0 top-0 z-50 hidden whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] font-medium tabular-nums text-white shadow-[0_4px_12px_rgba(0,0,0,0.25)]"
        style={{ display: "none" }}
      />

      {/* Réglage fin — ancré à côté de la bande, pas relégué sous la grille */}
      {selected && editable && selectedBox && (
        <div
          className="absolute z-50 w-[236px] rounded-xl border border-gray-200/90 bg-white p-3 shadow-[0_12px_32px_-8px_rgba(15,23,42,0.28),0_2px_8px_-2px_rgba(15,23,42,0.12)]"
          style={{
            top: Math.min(
              Math.max(0, topOf(selected.startMin) + selectedBox.top - 8),
              selectedBox.top + selectedBox.height - 150,
            ),
            ...(selectedBox.left + selectedBox.width + 256 < gridWidth
              ? { left: selectedBox.left + selectedBox.width + 8 }
              : { left: Math.max(0, selectedBox.left - 256) }),
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="mb-2.5 flex items-baseline gap-1.5 border-b border-gray-100 pb-2">
            <span className="text-[13px] font-semibold text-gray-900">
              {DAY_LABELS[(days[selected.dayIndex]?.getDay() + 6) % 7]}{" "}
              {days[selected.dayIndex]?.getDate()}
            </span>
            {selected.laneId && (
              <span className="text-[11px] text-gray-400">salle {selected.laneId}</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">de</span>
              <TimeSelect
                valueMin={selected.startMin}
                onChange={(min) => updateBand(selected.id, { startMin: min })}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">à</span>
              <TimeSelect
                valueMin={selected.endMin}
                onChange={(min) => updateBand(selected.id, { endMin: min })}
              />
            </label>
          </div>

          <div className="mt-2.5 flex items-center justify-between border-t border-gray-100 pt-2">
            <span className="text-[11px] font-medium tabular-nums text-gray-500">
              {formatDuration(selected.endMin - selected.startMin)}
            </span>
            <button
              type="button"
              onClick={() => removeBand(selected.id)}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-50"
            >
              Supprimer
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
