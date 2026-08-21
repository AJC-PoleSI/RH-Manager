"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import api from "@/lib/api";

// FullCalendar
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { EventInput, EventClickArg } from "@fullcalendar/core";

// ─── Types ───────────────────────────────────────────────────────────
interface CalendarAdminBuilderProps {
  selectedEpreuveId: string;
  epreuve: any;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  viewMode?: "creation" | "evaluators" | "candidates";
  /** Incrémenté par le parent pour forcer un re-fetch des créneaux
   *  (ex. après création/modification d'une ouverture). */
  refreshKey?: number;
}

interface SlotData {
  id: string;
  date: string;
  start_time?: string;
  startTime?: string;
  end_time?: string;
  endTime?: string;
  room?: string;
  status?: string;
  duration_minutes?: number;
  durationMinutes?: number;
  epreuve_id?: string;
  epreuveId?: string;
  label?: string;
  members?: {
    member: {
      email: string;
      firstName?: string;
      lastName?: string;
      first_name?: string;
      last_name?: string;
    };
  }[];
  enrollments?: { candidate: { first_name: string; last_name: string } }[];
  maxCandidates?: number;
  max_candidates?: number;
}

// ─── Constants ───────────────────────────────────────────────────────
const ROOM_COLORS: Record<
  string,
  { bg: string; border: string; text: string }
> = {};
const ROOM_PALETTE = [
  { bg: "#DBEAFE", border: "#3B82F6", text: "#1E40AF" }, // Blue
  { bg: "#E9D5FF", border: "#8B5CF6", text: "#6D28D9" }, // Violet
  { bg: "#D1FAE5", border: "#10B981", text: "#065F46" }, // Green
  { bg: "#FEF3C7", border: "#F59E0B", text: "#92400E" }, // Orange
  { bg: "#FCE7F3", border: "#EC4899", text: "#9D174D" }, // Pink
  { bg: "#CFFAFE", border: "#06B6D4", text: "#155E75" }, // Cyan
];

// Repli quand aucun créneau n'existe encore : la plage est alors inconnue.
const FALLBACK_MIN_TIME = "08:00:00";
const FALLBACK_MAX_TIME = "19:00:00";

/** Hauteur (px) d'une ligne de 30 min selon la densité choisie.
 *  Compact : la journée entière tient à l'écran sans scroller. */
const ROW_HEIGHT: Record<Density, number> = {
  compact: 16,
  confort: 34,
};

type Density = "compact" | "confort";

// ─── Helpers ─────────────────────────────────────────────────────────
/** Get Monday of the week containing `date` */
function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatWeekRange(monday: Date): string {
  const friday = new Date(monday);
  friday.setDate(friday.getDate() + 4);
  const opts: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "long",
  };
  const monStr = monday.toLocaleDateString("fr-FR", opts);
  const friStr = friday.toLocaleDateString("fr-FR", {
    ...opts,
    year: "numeric",
  });
  return `Du ${monStr} au ${friStr}`;
}

function formatDateISO(d: Date): string {
  // Utiliser les composantes locales (pas UTC) pour éviter le décalage fuseau horaire
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Arrondit à l'heure pleine, vers le bas (floor) ou vers le haut (ceil).
 *  Les libellés horaires tombent ainsi sur des :00 et non des :30. */
function snapToHour(mins: number, dir: "floor" | "ceil"): number {
  const snapped =
    dir === "floor" ? Math.floor(mins / 60) * 60 : Math.ceil(mins / 60) * 60;
  return Math.min(24 * 60, Math.max(0, snapped));
}

function minutesToTimeString(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

function getRoomColor(room: string, roomIndex: number) {
  if (!ROOM_COLORS[room]) {
    ROOM_COLORS[room] = ROOM_PALETTE[roomIndex % ROOM_PALETTE.length];
  }
  return ROOM_COLORS[room];
}

function memberName(m: any): string {
  const first = m?.member?.firstName || m?.member?.first_name || "";
  const last = m?.member?.lastName || m?.member?.last_name || "";
  return `${first} ${last}`.trim() || m?.member?.email || "—";
}

// ─── Component ───────────────────────────────────────────────────────
/**
 * Vue de CONTRÔLE du planning d'une épreuve. Les créneaux sont créés et
 * modifiés via le tableau des ouvertures de salles (OpeningsManager) : ce
 * calendrier ne fait que les afficher, avec un détail au clic.
 */
export default function CalendarAdminBuilder({
  selectedEpreuveId,
  epreuve,
  toast,
  viewMode = "creation",
  refreshKey = 0,
}: CalendarAdminBuilderProps) {
  // State
  const [slots, setSlots] = useState<SlotData[]>([]);
  const [loading, setLoading] = useState(false);
  const [density, setDensity] = useState<Density>("compact");
  /** null = plage horaire déduite automatiquement des créneaux. */
  const [manualRange, setManualRange] = useState<{
    min: string;
    max: string;
  } | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [currentWeekLabel, setCurrentWeekLabel] = useState("");
  const [detailSlot, setDetailSlot] = useState<SlotData | null>(null);

  // Refs
  const calendarRef = useRef<FullCalendar>(null);

  // Computed from epreuve
  const durationMinutes =
    epreuve?.durationMinutes || epreuve?.duration_minutes || 30;
  const roulementMinutes =
    epreuve?.roulementMinutes || epreuve?.roulement_minutes || 10;
  const totalSlotDuration = durationMinutes + roulementMinutes;

  // Liste des salles réellement utilisées par les créneaux existants.
  const roomList = useMemo(() => {
    return (
      Array.from(new Set(slots.map((s) => s.room).filter(Boolean))) as string[]
    ).sort();
  }, [slots]);

  // ─── Plage horaire affichée ──────────────────────────────────────
  // Par défaut on colle aux créneaux existants (arrondi à l'heure pleine) :
  // inutile d'afficher 07h→20h quand tout se joue entre 9h et 13h.
  const autoRange = useMemo(() => {
    if (slots.length === 0) {
      return { min: FALLBACK_MIN_TIME, max: FALLBACK_MAX_TIME };
    }
    let minMins = 24 * 60;
    let maxMins = 0;
    slots.forEach((s) => {
      const start = toMinutes(s.start_time || s.startTime || "08:00");
      const end = toMinutes(s.end_time || s.endTime || "09:00");
      if (start < minMins) minMins = start;
      if (end > maxMins) maxMins = end;
    });
    if (minMins >= maxMins) {
      return { min: FALLBACK_MIN_TIME, max: FALLBACK_MAX_TIME };
    }
    return {
      min: minutesToTimeString(snapToHour(minMins, "floor")),
      max: minutesToTimeString(snapToHour(maxMins, "ceil")),
    };
  }, [slots]);

  const slotMinTime = manualRange?.min ?? autoRange.min;
  const slotMaxTime = manualRange?.max ?? autoRange.max;

  // ─── validRange for FullCalendar ─────────────────────────────────
  const validRange = useMemo(() => {
    const start = epreuve?.dateDebut || epreuve?.date_debut;
    const end = epreuve?.dateFin || epreuve?.date_fin;
    if (start && end) {
      const endPlus = new Date(end + "T12:00:00");
      endPlus.setDate(endPlus.getDate() + 1);
      return { start: start, end: formatDateISO(endPlus) };
    }
    return undefined;
  }, [epreuve]);

  // ─── Initial date: first Monday of the epreuve date range ────────
  const initialDate = useMemo(() => {
    const start = epreuve?.dateDebut || epreuve?.date_debut;
    if (start) {
      return getMonday(new Date(start + "T12:00:00"));
    }
    return getMonday(new Date());
  }, [epreuve]);

  // ─── API ─────────────────────────────────────────────────────────
  const fetchSlots = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get(`/slots/all?epreuve=${selectedEpreuveId}`);
      const filtered = (res.data || []).filter(
        (s: any) =>
          s.epreuve_id === selectedEpreuveId ||
          s.epreuveId === selectedEpreuveId,
      );
      setSlots(filtered);
    } catch (e) {
      console.error(e);
      toast("Erreur lors du chargement des créneaux", "error");
    } finally {
      setLoading(false);
    }
  }, [selectedEpreuveId, toast]);

  // ─── Effects ─────────────────────────────────────────────────────
  useEffect(() => {
    if (selectedEpreuveId) fetchSlots();
  }, [selectedEpreuveId, fetchSlots, refreshKey]);

  // ─── Build FullCalendar events ────────────────────────────────────
  const events: EventInput[] = useMemo(() => {
    return slots.map((slot) => {
      const startTime = slot.start_time || slot.startTime || "08:00";
      const endTime = slot.end_time || slot.endTime || "09:00";
      const dateStr = (slot.date || "").split("T")[0];
      const room = slot.room || "Salle 1";
      const roomIdx = roomList.indexOf(room);
      const color = getRoomColor(room, roomIdx >= 0 ? roomIdx : 0);

      return {
        id: slot.id,
        title: room,
        start: `${dateStr}T${startTime}:00`,
        end: `${dateStr}T${endTime}:00`,
        backgroundColor: color.bg,
        borderColor: color.border,
        textColor: color.text,
        extendedProps: {
          slotId: slot.id,
          room,
          startTime,
          endTime,
          status: slot.status,
          duration:
            slot.duration_minutes || slot.durationMinutes || durationMinutes,
          members: slot.members || [],
          enrollments: slot.enrollments || [],
          maxCandidates: slot.maxCandidates || slot.max_candidates || 1,
        },
      };
    });
  }, [slots, roomList, durationMinutes]);

  // ─── FullCalendar handlers ────────────────────────────────────────

  /** Clic sur un créneau → détail en lecture seule */
  const handleEventClick = useCallback(
    (info: EventClickArg) => {
      const slotId = info.event.extendedProps?.slotId || info.event.id;
      const sl = slots.find((s) => s.id === slotId);
      if (sl) setDetailSlot(sl);
    },
    [slots],
  );

  /** Custom event rendering */
  const renderEventContent = useCallback(
    (eventInfo: any) => {
      const start =
        eventInfo.event.start?.toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
        }) || "";
      const room = eventInfo.event.extendedProps?.room || "";
      const members = eventInfo.event.extendedProps?.members || [];
      const enrollments = eventInfo.event.extendedProps?.enrollments || [];
      const maxCand = eventInfo.event.extendedProps?.maxCandidates || 1;
      const isOccupied = members.length > 0 || enrollments.length > 0;

      // En mode compact, un créneau de 30 min ne fait que ~16px : on
      // n'affiche qu'une ligne dense (heure + salle ou effectif).
      if (density === "compact") {
        let badge = "";
        if (viewMode === "evaluators") {
          badge = members.length > 0 ? `${members.length} éval` : "0 éval";
        } else if (viewMode === "candidates") {
          badge = `${enrollments.length}/${maxCand}`;
        } else {
          badge = room;
        }
        return (
          <div className="fc-compact-event" title={`${start} · ${room}`}>
            <span className="fc-compact-time">{start}</span>
            <span className="fc-compact-badge">
              {isOccupied && viewMode === "creation" ? "🔒 " : ""}
              {badge}
            </span>
          </div>
        );
      }

      if (viewMode === "evaluators") {
        return (
          <div className="relative w-full h-full p-1 overflow-hidden">
            <div className="text-[10px] font-bold truncate opacity-80 mb-0.5">
              {start} - {room}
            </div>
            {members.length > 0 ? (
              members.map((m: any, i: number) => (
                <div
                  key={i}
                  className="text-[9px] font-medium leading-tight truncate text-blue-900 bg-blue-100/90 rounded px-1 mb-0.5"
                  title={memberName(m)}
                >
                  {memberName(m)}
                </div>
              ))
            ) : (
              <div className="text-[9px] italic text-red-700 bg-red-100/80 px-1 rounded">
                0 éval
              </div>
            )}
          </div>
        );
      }

      if (viewMode === "candidates") {
        return (
          <div className="relative w-full h-full p-1 overflow-hidden">
            <div className="text-[10px] font-bold truncate opacity-80 mb-0.5">
              {start} - {room}
            </div>
            <div className="text-[9px] font-medium bg-black/10 px-1 rounded inline-block mb-1 opacity-90">
              {enrollments.length}/{maxCand} inscrit(s)
            </div>
            {enrollments.length > 0 ? (
              enrollments.map((e: any, i: number) => (
                <div
                  key={i}
                  className="text-[9px] font-medium leading-tight truncate text-green-900 bg-green-100/90 rounded px-1 flex mb-0.5"
                >
                  🎓 {e.candidate?.first_name} {e.candidate?.last_name}
                </div>
              ))
            ) : (
              <div className="text-[9px] italic text-gray-500 opacity-80 pl-1">
                Vide
              </div>
            )}
          </div>
        );
      }

      const end =
        eventInfo.event.end?.toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
        }) || "";
      return (
        <div className="relative w-full h-full px-1 py-0.5 overflow-hidden">
          <div className="text-[10px] font-bold leading-tight truncate">
            {isOccupied && "🔒 "}
            {room}
          </div>
          <div className="text-[10px] leading-tight opacity-80">
            {start} – {end}
          </div>
        </div>
      );
    },
    [viewMode, density],
  );

  /** Week header label update */
  const handleDatesSet = useCallback((info: any) => {
    const monday = getMonday(info.start);
    setCurrentWeekLabel(formatWeekRange(monday));
  }, []);

  // ─── Navigation ──────────────────────────────────────────────────
  function navigatePrev() {
    calendarRef.current?.getApi().prev();
  }
  function navigateNext() {
    calendarRef.current?.getApi().next();
  }
  function navigateToday() {
    calendarRef.current?.getApi().today();
  }

  // ─── Guard ───────────────────────────────────────────────────────
  if (!epreuve) return null;

  const hasDateRange = epreuve?.dateDebut || epreuve?.date_debut;
  if (!hasDateRange) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
        <p className="text-gray-500 mb-2">
          Les dates de cette épreuve ne semblent pas configurées.
        </p>
        <p className="text-sm text-gray-400">
          Veuillez paramétrer l&apos;épreuve dans les Réglages (Date de début et
          fin).
        </p>
      </div>
    );
  }

  const rowHeight = ROW_HEIGHT[density];

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
      {/* ═══ HEADER ═══ */}
      <div className="px-5 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-gray-900">
              📅 Vue du planning
            </h2>
            {loading && (
              <span className="text-xs text-blue-600 animate-pulse">
                Synchronisation…
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
              {durationMinutes}min + {roulementMinutes}min roulement ={" "}
              {totalSlotDuration}min/créneau
            </span>
            {/* Densité d'affichage */}
            <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden">
              {(
                [
                  ["compact", "Compact"],
                  ["confort", "Confort"],
                ] as [Density, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setDensity(key)}
                  className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    density === key
                      ? "bg-blue-600 text-white"
                      : "bg-white text-gray-500 hover:bg-gray-50"
                  }`}
                  title={
                    key === "compact"
                      ? "Toute la journée visible d'un coup d'œil"
                      : "Créneaux plus grands, plus de détail"
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Paramètres plage horaire"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                <path
                  d="M10 13a3 3 0 100-6 3 3 0 000 6z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M17.4 12.5a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V18a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H8a1.65 1.65 0 001-1.51V2a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V8a1.65 1.65 0 001.51 1H18a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Week navigation */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={navigatePrev}
              className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              ‹ Précédent
            </button>
            <button
              onClick={navigateToday}
              className="px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
            >
              Aujourd&apos;hui
            </button>
            <button
              onClick={navigateNext}
              className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Suivant ›
            </button>
          </div>
          <h3 className="text-sm font-semibold text-gray-800">
            {currentWeekLabel}
          </h3>
        </div>
      </div>

      {/* Config panel (plage horaire visible) */}
      {showConfig && (
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/80 flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">Début :</label>
            <input
              type="time"
              value={slotMinTime.slice(0, 5)}
              onChange={(e) => {
                const val = e.target.value;
                if (val && /^\d{2}:\d{2}$/.test(val)) {
                  const newMin = val + ":00";
                  if (newMin < slotMaxTime)
                    setManualRange({ min: newMin, max: slotMaxTime });
                }
              }}
              className="border border-gray-300 rounded-md px-2 py-1 text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">Fin :</label>
            <input
              type="time"
              value={slotMaxTime.slice(0, 5)}
              onChange={(e) => {
                const val = e.target.value;
                if (val && /^\d{2}:\d{2}$/.test(val)) {
                  const newMax = val + ":00";
                  if (newMax > slotMinTime)
                    setManualRange({ min: slotMinTime, max: newMax });
                }
              }}
              className="border border-gray-300 rounded-md px-2 py-1 text-xs"
            />
          </div>
          {manualRange ? (
            <button
              onClick={() => setManualRange(null)}
              className="text-[11px] font-medium text-blue-600 hover:text-blue-800 underline"
            >
              Revenir à l&apos;ajustement automatique
            </button>
          ) : (
            <span className="text-[10px] text-gray-400">
              Plage ajustée automatiquement sur vos créneaux
            </span>
          )}
        </div>
      )}

      {/* ═══ FULLCALENDAR WEEK VIEW ═══ */}
      <div className="p-4 flex-1 bg-gray-50/30">
        <p className="text-xs text-gray-500 mb-3">
          👁️ <strong>Vue de contrôle</strong> — les créneaux sont gérés via le
          tableau des ouvertures ci-dessus · clic sur un créneau pour le détail
          · 🔒 = créneau occupé
        </p>

        <div className="calendar-week-grid bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <FullCalendar
            ref={calendarRef}
            plugins={[timeGridPlugin]}
            initialView="timeGridWeek"
            initialDate={formatDateISO(initialDate)}
            locale="fr"
            firstDay={1}
            weekends={false}
            headerToolbar={false}
            allDaySlot={false}
            slotMinTime={slotMinTime}
            slotMaxTime={slotMaxTime}
            slotDuration="00:30:00"
            slotLabelInterval="01:00:00"
            slotLabelFormat={{
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            }}
            dayHeaderFormat={{
              weekday: "short",
              day: "numeric",
              month: "short",
            }}
            height="auto"
            expandRows={false}
            editable={false}
            selectable={false}
            eventStartEditable={false}
            eventDurationEditable={false}
            eventMinHeight={density === "compact" ? 14 : 24}
            validRange={validRange}
            eventClick={handleEventClick}
            eventContent={renderEventContent}
            datesSet={handleDatesSet}
            events={events}
            nowIndicator={true}
          />
        </div>
      </div>

      {/* Modal détail créneau (lecture seule) */}
      {detailSlot && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setDetailSlot(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-gray-100 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-gray-900">
                  {detailSlot.room || "Salle"}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {new Date(
                    (detailSlot.date || "").split("T")[0] + "T12:00:00",
                  ).toLocaleDateString("fr-FR", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}{" "}
                  ·{" "}
                  {(detailSlot.start_time || detailSlot.startTime || "").slice(
                    0,
                    5,
                  )}
                  –
                  {(detailSlot.end_time || detailSlot.endTime || "").slice(0, 5)}
                </p>
              </div>
              <button
                onClick={() => setDetailSlot(null)}
                className="text-gray-400 hover:text-gray-600 p-1 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1.5">
                  Examinateurs ({(detailSlot.members || []).length})
                </p>
                {(detailSlot.members || []).length === 0 ? (
                  <p className="text-xs text-red-600 italic">
                    Aucun examinateur assigné
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {(detailSlot.members || []).map((m, i) => (
                      <li key={i} className="text-sm text-gray-700">
                        · {memberName(m)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1.5">
                  Candidats ({(detailSlot.enrollments || []).length}/
                  {detailSlot.maxCandidates || detailSlot.max_candidates || 1})
                </p>
                {(detailSlot.enrollments || []).length === 0 ? (
                  <p className="text-xs text-gray-400 italic">
                    Aucun candidat inscrit
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {(detailSlot.enrollments || []).map((e: any, i: number) => (
                      <li key={i} className="text-sm text-gray-700">
                        🎓 {e.candidate?.first_name} {e.candidate?.last_name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ LEGEND ═══ */}
      <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 flex items-center gap-4 text-[11px] text-gray-500 flex-wrap">
        <span className="font-medium text-gray-600">Légende :</span>
        {roomList.length === 0 && (
          <span className="text-gray-400 italic">Aucune salle utilisée</span>
        )}
        {roomList.map((room, idx) => {
          const color = getRoomColor(room, idx);
          const count = slots.filter((s) => s.room === room).length;
          return (
            <span key={room} className="flex items-center gap-1.5">
              <span
                className="w-3 h-3 rounded"
                style={{
                  backgroundColor: color.bg,
                  border: `2px solid ${color.border}`,
                }}
              />
              {room}
              <span className="text-gray-400">({count})</span>
            </span>
          );
        })}
        <span className="ml-auto text-gray-400">
          {slots.length} créneau{slots.length !== 1 ? "x" : ""} au total
        </span>
      </div>

      {/* ═══ CSS OVERRIDES ═══ */}
      <style jsx global>{`
        .calendar-week-grid {
          --fc-row-height: ${rowHeight}px;
        }
        .calendar-week-grid .fc {
          font-family: inherit;
          border: none;
        }
        /* Day header */
        .calendar-week-grid .fc .fc-col-header-cell {
          background: #f9fafb;
          border-bottom: 2px solid #e5e7eb;
          padding: 6px 4px;
        }
        .calendar-week-grid .fc .fc-col-header-cell-cushion {
          font-weight: 600;
          font-size: 12px;
          color: #374151;
          text-transform: capitalize;
        }
        /* Today column highlight */
        .calendar-week-grid .fc .fc-day-today {
          background: rgba(59, 130, 246, 0.03) !important;
        }
        .calendar-week-grid
          .fc
          .fc-col-header-cell.fc-day-today
          .fc-col-header-cell-cushion {
          color: #2563eb;
        }
        /* Time grid — la hauteur de ligne pilote toute la densité */
        .calendar-week-grid .fc .fc-timegrid-slot {
          height: var(--fc-row-height);
          border-color: #f3f4f6;
        }
        .calendar-week-grid .fc .fc-timegrid-slot-minor {
          border-top-style: dotted;
          border-color: #f9fafb;
        }
        .calendar-week-grid .fc .fc-timegrid-axis {
          font-size: 10px;
          color: #9ca3af;
          font-weight: 500;
        }
        .calendar-week-grid .fc .fc-timegrid-slot-label-cushion {
          font-size: 10px;
          padding: 0 6px;
        }
        .calendar-week-grid .fc .fc-timegrid-axis-cushion {
          padding: 2px 6px;
        }
        /* Events */
        .calendar-week-grid .fc .fc-timegrid-col-events {
          margin: 0 1px;
        }
        .calendar-week-grid .fc .fc-timegrid-event {
          border-radius: 4px;
          border-left-width: 3px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
          cursor: pointer;
          transition:
            box-shadow 0.15s,
            transform 0.15s;
          overflow: hidden;
        }
        .calendar-week-grid .fc .fc-timegrid-event:hover {
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          transform: scale(1.02);
          z-index: 10 !important;
        }
        .calendar-week-grid .fc .fc-timegrid-event .fc-event-main {
          padding: 0;
          overflow: hidden;
        }
        /* Rendu compact : une seule ligne heure + badge */
        .fc-compact-event {
          display: flex;
          align-items: center;
          gap: 3px;
          width: 100%;
          height: 100%;
          padding: 0 3px;
          font-size: 9px;
          line-height: 1;
          overflow: hidden;
          white-space: nowrap;
        }
        .fc-compact-event .fc-compact-time {
          font-weight: 700;
          flex-shrink: 0;
        }
        .fc-compact-event .fc-compact-badge {
          opacity: 0.85;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        /* Now indicator */
        .calendar-week-grid .fc .fc-timegrid-now-indicator-line {
          border-color: #ef4444;
          border-width: 2px;
        }
        /* Scrollgrid borders */
        .calendar-week-grid .fc .fc-scrollgrid {
          border: none;
        }
        .calendar-week-grid .fc td,
        .calendar-week-grid .fc th {
          border-color: #f3f4f6;
        }
      `}</style>
    </div>
  );
}
