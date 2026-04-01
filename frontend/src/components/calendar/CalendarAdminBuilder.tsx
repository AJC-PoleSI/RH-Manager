"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import api from "@/lib/api";

// FullCalendar
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type {
  EventInput,
  EventDropArg,
  EventClickArg,
} from "@fullcalendar/core";
import type { DateClickArg } from "@fullcalendar/interaction";

// ─── Types ───────────────────────────────────────────────────────────
interface CalendarAdminBuilderProps {
  selectedEpreuveId: string;
  epreuve: any;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onUpdate: () => void;
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
}

// ─── Constants ───────────────────────────────────────────────────────
const ROOM_COLORS: Record<string, { bg: string; border: string; text: string }> = {};
const ROOM_PALETTE = [
  { bg: "#DBEAFE", border: "#3B82F6", text: "#1E40AF" }, // Blue
  { bg: "#E9D5FF", border: "#8B5CF6", text: "#6D28D9" }, // Violet
  { bg: "#D1FAE5", border: "#10B981", text: "#065F46" }, // Green
  { bg: "#FEF3C7", border: "#F59E0B", text: "#92400E" }, // Orange
  { bg: "#FCE7F3", border: "#EC4899", text: "#9D174D" }, // Pink
  { bg: "#CFFAFE", border: "#06B6D4", text: "#155E75" }, // Cyan
];

const DEFAULT_MIN_TIME = "07:00:00";
const DEFAULT_MAX_TIME = "20:00:00";

// ─── Helpers ─────────────────────────────────────────────────────────
function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${Math.floor(total / 60)
    .toString()
    .padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
}

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
  return d.toISOString().split("T")[0];
}

function getRoomColor(room: string, roomIndex: number) {
  if (!ROOM_COLORS[room]) {
    ROOM_COLORS[room] = ROOM_PALETTE[roomIndex % ROOM_PALETTE.length];
  }
  return ROOM_COLORS[room];
}

// ─── Component ───────────────────────────────────────────────────────
export default function CalendarAdminBuilder({
  selectedEpreuveId,
  epreuve,
  toast,
  onUpdate,
}: CalendarAdminBuilderProps) {
  // State
  const [slots, setSlots] = useState<SlotData[]>([]);
  const [loading, setLoading] = useState(false);
  const [slotMinTime, setSlotMinTime] = useState(DEFAULT_MIN_TIME);
  const [slotMaxTime, setSlotMaxTime] = useState(DEFAULT_MAX_TIME);
  const [showConfig, setShowConfig] = useState(false);
  const [currentWeekLabel, setCurrentWeekLabel] = useState("");

  // Refs
  const calendarRef = useRef<FullCalendar>(null);

  // Computed from epreuve
  const durationMinutes =
    epreuve?.durationMinutes || epreuve?.duration_minutes || 30;
  const roulementMinutes =
    epreuve?.roulementMinutes || epreuve?.roulement_minutes || 10;
  const totalSlotDuration = durationMinutes + roulementMinutes;
  const nbSalles = parseInt(
    epreuve?.nbSalles || epreuve?.nb_salles || "1"
  );

  // Build unique room list from existing slots + expected rooms
  const roomList = useMemo(() => {
    const roomsFromSlots = Array.from(
      new Set(slots.map((s) => s.room).filter(Boolean))
    ) as string[];
    // Add expected rooms that might not have slots yet
    for (let i = 1; i <= nbSalles; i++) {
      const defaultName = `Salle ${i}`;
      if (!roomsFromSlots.includes(defaultName)) {
        roomsFromSlots.push(defaultName);
      }
    }
    return roomsFromSlots.sort();
  }, [slots, nbSalles]);

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

  // ─── Effects ─────────────────────────────────────────────────────
  useEffect(() => {
    if (selectedEpreuveId) fetchSlots();
  }, [selectedEpreuveId]);

  // ─── API ─────────────────────────────────────────────────────────
  async function fetchSlots() {
    try {
      setLoading(true);
      const res = await api.get(`/slots/all?epreuve=${selectedEpreuveId}`);
      const filtered = (res.data || []).filter(
        (s: any) =>
          s.epreuve_id === selectedEpreuveId ||
          s.epreuveId === selectedEpreuveId
      );
      setSlots(filtered);
    } catch (e) {
      console.error(e);
      toast("Erreur lors du chargement des créneaux", "error");
    } finally {
      setLoading(false);
    }
  }

  async function createSlot(date: string, startTime: string, room: string) {
    const endTime = addMinutes(startTime, durationMinutes);
    try {
      setLoading(true);
      await api.post("/slots", {
        epreuveId: selectedEpreuveId,
        date,
        startTime,
        endTime,
        durationMinutes,
        room,
        tour: epreuve?.tour || 1,
        maxCandidates: epreuve?.isGroupEpreuve
          ? epreuve?.groupSize || 1
          : 1,
        minMembers:
          epreuve?.minEvaluatorsPerSalle ||
          epreuve?.min_evaluators_per_salle ||
          2,
      });
      toast(`Créneau créé : ${startTime} → ${endTime} (${room})`, "success");
      fetchSlots();
      onUpdate();
    } catch (error: any) {
      toast(
        error.response?.data?.error || "Erreur création du créneau",
        "error"
      );
    } finally {
      setLoading(false);
    }
  }

  async function moveSlot(
    slotId: string,
    newDate: string,
    newStartTime: string
  ) {
    const newEndTime = addMinutes(newStartTime, durationMinutes);
    try {
      setLoading(true);
      await api.put(`/slots/${slotId}`, {
        date: newDate,
        startTime: newStartTime,
        endTime: newEndTime,
      });
      toast(
        `Créneau déplacé → ${newDate} ${newStartTime} - ${newEndTime}`,
        "success"
      );
      fetchSlots();
      onUpdate();
    } catch (error: any) {
      toast(
        error.response?.data?.error || "Erreur déplacement",
        "error"
      );
    } finally {
      setLoading(false);
    }
  }

  async function deleteSlot(slotId: string) {
    if (!window.confirm("Supprimer ce créneau définitivement ?")) return;
    try {
      setLoading(true);
      await api.delete(`/slots/${slotId}`);
      toast("Créneau supprimé", "success");
      fetchSlots();
      onUpdate();
    } catch {
      toast("Erreur suppression", "error");
    } finally {
      setLoading(false);
    }
  }

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
          duration: slot.duration_minutes || slot.durationMinutes || durationMinutes,
        },
      };
    });
  }, [slots, roomList, durationMinutes]);

  // ─── FullCalendar handlers ────────────────────────────────────────

  /** Click on grid → create slot (ask which room if multiple) */
  const handleDateClick = useCallback(
    (info: DateClickArg) => {
      const clickedDate = info.date;
      // Skip weekends
      if (clickedDate.getDay() === 0 || clickedDate.getDay() === 6) return;

      const dateStr = formatDateISO(clickedDate);
      const hours = clickedDate
        .getHours()
        .toString()
        .padStart(2, "0");
      const minutes = clickedDate
        .getMinutes()
        .toString()
        .padStart(2, "0");
      const startTime = `${hours}:${minutes}`;

      if (roomList.length <= 1) {
        createSlot(dateStr, startTime, roomList[0] || "Salle 1");
      } else {
        // Quick room picker
        const choice = window.prompt(
          `Créer un créneau à ${startTime} le ${new Date(dateStr + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}\n\nChoisissez la salle (numéro) :\n${roomList.map((r, i) => `  ${i + 1}. ${r}`).join("\n")}`,
          "1"
        );
        if (!choice) return;
        const idx = parseInt(choice) - 1;
        const room = roomList[idx] || roomList[0] || "Salle 1";
        createSlot(dateStr, startTime, room);
      }
    },
    [roomList, selectedEpreuveId]
  );

  /** Drag event to new time/day → update slot */
  const handleEventDrop = useCallback(
    (info: EventDropArg) => {
      const event = info.event;
      const slotId = event.extendedProps?.slotId || event.id;

      if (!event.start) {
        info.revert();
        return;
      }

      const newDate = formatDateISO(event.start);

      // Skip weekends
      if (event.start.getDay() === 0 || event.start.getDay() === 6) {
        toast("Impossible de déplacer sur un week-end", "error");
        info.revert();
        return;
      }

      const newStartTime = `${event.start
        .getHours()
        .toString()
        .padStart(2, "0")}:${event.start
        .getMinutes()
        .toString()
        .padStart(2, "0")}`;

      moveSlot(slotId, newDate, newStartTime);
    },
    [durationMinutes]
  );

  /** Click on event → delete */
  const handleEventClick = useCallback(
    (info: EventClickArg) => {
      const target = info.jsEvent?.target as HTMLElement;
      if (target?.classList?.contains("fc-event-delete-btn")) {
        const slotId =
          info.event.extendedProps?.slotId || info.event.id;
        deleteSlot(slotId);
      }
    },
    []
  );

  /** Custom event rendering */
  const renderEventContent = useCallback(
    (eventInfo: any) => {
      const start =
        eventInfo.event.start?.toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
        }) || "";
      const end =
        eventInfo.event.end?.toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
        }) || "";
      const room = eventInfo.event.extendedProps?.room || "";
      const dur = eventInfo.event.extendedProps?.duration;

      return (
        <div className="relative w-full h-full px-1 py-0.5 overflow-hidden">
          <button
            className="fc-event-delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              const slotId =
                eventInfo.event.extendedProps?.slotId ||
                eventInfo.event.id;
              deleteSlot(slotId);
            }}
            title="Supprimer"
          >
            ✕
          </button>
          <div className="text-[10px] font-bold leading-tight truncate">
            {room}
          </div>
          <div className="text-[10px] leading-tight opacity-80">
            {start} – {end}
          </div>
          {dur && (
            <div className="text-[9px] opacity-60">{dur}min</div>
          )}
        </div>
      );
    },
    []
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
          Veuillez paramétrer l&apos;épreuve dans les Réglages (Date de
          début et fin).
        </p>
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
      {/* ═══ HEADER ═══ */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-gray-900">
              📅 Calendar Builder
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
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Paramètres"
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

      {/* Config panel */}
      {showConfig && (
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/80 flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">
              Début :
            </label>
            <input
              type="time"
              value={slotMinTime.slice(0, 5)}
              onChange={(e) =>
                setSlotMinTime(e.target.value + ":00")
              }
              className="border border-gray-300 rounded-md px-2 py-1 text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">
              Fin :
            </label>
            <input
              type="time"
              value={slotMaxTime.slice(0, 5)}
              onChange={(e) =>
                setSlotMaxTime(e.target.value + ":00")
              }
              className="border border-gray-300 rounded-md px-2 py-1 text-xs"
            />
          </div>
          <span className="text-[10px] text-gray-400">
            Plage horaire visible du calendrier
          </span>
        </div>
      )}

      {/* ═══ FULLCALENDAR WEEK VIEW ═══ */}
      <div className="p-4 flex-1 bg-gray-50/30">
        {/* Instructions */}
        <p className="text-xs text-gray-500 mb-3">
          <strong>Clic</strong> pour créer · <strong>Glissez</strong>{" "}
          pour déplacer (snap 5min, multi-jours) ·{" "}
          <strong>✕</strong> au survol pour supprimer
        </p>

        <div className="calendar-week-grid bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <FullCalendar
            ref={calendarRef}
            plugins={[timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            initialDate={formatDateISO(initialDate)}
            locale="fr"
            firstDay={1}
            weekends={false}
            headerToolbar={false}
            allDaySlot={false}
            slotMinTime={slotMinTime}
            slotMaxTime={slotMaxTime}
            slotDuration="00:05:00"
            snapDuration="00:05:00"
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
            expandRows={true}
            editable={true}
            droppable={false}
            eventDurationEditable={false}
            eventStartEditable={true}
            selectable={false}
            validRange={validRange}
            dateClick={handleDateClick}
            eventDrop={handleEventDrop}
            eventClick={handleEventClick}
            eventContent={renderEventContent}
            datesSet={handleDatesSet}
            events={events}
            nowIndicator={true}
          />
        </div>
      </div>

      {/* ═══ LEGEND ═══ */}
      <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 flex items-center gap-4 text-[11px] text-gray-500 flex-wrap">
        <span className="font-medium text-gray-600">Légende :</span>
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
        .calendar-week-grid .fc {
          font-family: inherit;
          border: none;
        }
        /* Day header */
        .calendar-week-grid .fc .fc-col-header-cell {
          background: #f9fafb;
          border-bottom: 2px solid #e5e7eb;
          padding: 10px 4px;
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
        /* Time grid */
        .calendar-week-grid .fc .fc-timegrid-slot {
          height: 20px;
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
        .calendar-week-grid .fc .fc-timegrid-axis-cushion {
          padding: 2px 6px;
        }
        /* Events */
        .calendar-week-grid .fc .fc-timegrid-col-events {
          margin: 0 2px;
        }
        .calendar-week-grid .fc .fc-timegrid-event {
          border-radius: 6px;
          border-left-width: 3px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
          cursor: grab;
          transition: box-shadow 0.15s, transform 0.15s;
          overflow: hidden;
        }
        .calendar-week-grid .fc .fc-timegrid-event:hover {
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          transform: scale(1.02);
          z-index: 10 !important;
        }
        .calendar-week-grid .fc .fc-timegrid-event:active {
          cursor: grabbing;
        }
        .calendar-week-grid .fc .fc-timegrid-event .fc-event-main {
          padding: 1px 2px;
          overflow: hidden;
        }
        /* Dragging */
        .calendar-week-grid .fc .fc-event-dragging {
          opacity: 0.85;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
          transform: scale(1.05);
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
        .calendar-week-grid .fc .fc-highlight {
          background-color: rgba(59, 130, 246, 0.12);
        }
        /* Delete button on event hover */
        .fc-event-delete-btn {
          position: absolute;
          top: 2px;
          right: 2px;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: rgba(239, 68, 68, 0.9);
          color: white;
          font-size: 9px;
          display: none;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          border: none;
          line-height: 1;
          z-index: 10;
        }
        .calendar-week-grid
          .fc
          .fc-timegrid-event:hover
          .fc-event-delete-btn {
          display: flex;
        }
      `}</style>
    </div>
  );
}
