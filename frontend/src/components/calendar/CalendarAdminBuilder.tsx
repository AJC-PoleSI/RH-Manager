"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import api from "@/lib/api";

// FullCalendar
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventInput, DateSelectArg, EventDropArg, EventClickArg } from "@fullcalendar/core";

// ─── Types ───────────────────────────────────────────────────────────
interface CalendarAdminBuilderProps {
  selectedEpreuveId: string;
  epreuve: any;
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void;
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
const ROOM_COLORS = [
  { bg: "#DBEAFE", border: "#3B82F6", text: "#1E40AF" }, // Blue
  { bg: "#E9D5FF", border: "#8B5CF6", text: "#6D28D9" }, // Violet
  { bg: "#D1FAE5", border: "#10B981", text: "#065F46" }, // Green
  { bg: "#FEF3C7", border: "#F59E0B", text: "#92400E" }, // Orange
  { bg: "#FCE7F3", border: "#EC4899", text: "#9D174D" }, // Pink
  { bg: "#CFFAFE", border: "#06B6D4", text: "#155E75" }, // Cyan
];

const DEFAULT_SLOT_MIN_TIME = "07:00:00";
const DEFAULT_SLOT_MAX_TIME = "20:00:00";

// ─── Helpers ─────────────────────────────────────────────────────────
function getValidDays(startStr?: string, endStr?: string): string[] {
  if (!startStr || !endStr) return [];
  const dStart = new Date(startStr);
  const dEnd = new Date(endStr);
  if (dStart > dEnd) return [];
  
  const days: string[] = [];
  const current = new Date(dStart);
  while (current <= dEnd) {
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      days.push(current.toISOString().split("T")[0]);
    }
    current.setDate(current.getDate() + 1);
  }
  return days;
}

function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${Math.floor(total / 60).toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
}

function formatDateFr(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" });
}

// ─── Component ───────────────────────────────────────────────────────
export default function CalendarAdminBuilder({
  selectedEpreuveId,
  epreuve,
  toast,
  onUpdate,
}: CalendarAdminBuilderProps) {
  const [existingSlots, setExistingSlots] = useState<SlotData[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Calendar config (modifiable)
  const [slotMinTime, setSlotMinTime] = useState(DEFAULT_SLOT_MIN_TIME);
  const [slotMaxTime, setSlotMaxTime] = useState(DEFAULT_SLOT_MAX_TIME);
  const [showConfig, setShowConfig] = useState(false);
  
  // Room renaming
  const [roomNames, setRoomNames] = useState<Record<number, string>>({});
  const [editingRoom, setEditingRoom] = useState<number | null>(null);
  const [tempRoomName, setTempRoomName] = useState("");
  
  // Quick create modal
  const [quickCreateModal, setQuickCreateModal] = useState<{
    day: string;
    startTime: string;
    room: string;
    roomIndex: number;
  } | null>(null);
  
  // Computed
  const validDays = getValidDays(epreuve?.dateDebut, epreuve?.dateFin);
  const [activeTabDay, setActiveTabDay] = useState<string>(validDays[0] || "");
  
  const nbSalles = parseInt(epreuve?.nbSalles || epreuve?.nb_salles || "1");
  const sallesArray = Array.from({ length: nbSalles }, (_, i) => i + 1);
  const durationMinutes = epreuve?.durationMinutes || epreuve?.duration_minutes || 30;
  const roulementMinutes = epreuve?.roulementMinutes || epreuve?.roulement_minutes || 10;
  const totalSlotDuration = durationMinutes + roulementMinutes;
  
  // Get room display name
  const getRoomName = useCallback((roomNum: number): string => {
    return roomNames[roomNum] || `Salle ${roomNum}`;
  }, [roomNames]);

  // ─── Effects ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (validDays.length > 0 && !validDays.includes(activeTabDay)) {
      setActiveTabDay(validDays[0]);
    }
  }, [epreuve, validDays]);

  useEffect(() => {
    if (selectedEpreuveId) {
      fetchSlots();
    }
  }, [selectedEpreuveId]);

  // Initialize room names from existing slots
  useEffect(() => {
    if (existingSlots.length > 0) {
      const names: Record<number, string> = {};
      existingSlots.forEach(slot => {
        const room = slot.room || "";
        // Check if it matches "Salle X" pattern
        const match = room.match(/^Salle (\d+)$/);
        if (!match && room) {
          // It was renamed — figure out which room number it belongs to
          // We'll store custom names by trying to map them
          sallesArray.forEach(num => {
            const existingSlotsForRoom = existingSlots.filter(s => s.room === room);
            if (existingSlotsForRoom.length > 0 && !names[num]) {
              // Try to assign by order of detection
            }
          });
        }
      });
      // Only set if we found custom names
      const customRooms: Record<number, string> = {};
      const uniqueRooms = Array.from(new Set(existingSlots.map(s => s.room).filter(Boolean)));
      uniqueRooms.sort().forEach((room, idx) => {
        const num = idx + 1;
        if (num <= nbSalles && room !== `Salle ${num}`) {
          customRooms[num] = room!;
        }
      });
      if (Object.keys(customRooms).length > 0) {
        setRoomNames(prev => ({ ...prev, ...customRooms }));
      }
    }
  }, [existingSlots, nbSalles]);

  // ─── API ─────────────────────────────────────────────────────────────
  async function fetchSlots() {
    try {
      setLoading(true);
      const res = await api.get(`/slots/all?epreuve=${selectedEpreuveId}`);
      const filtered = (res.data || []).filter((s: any) =>
        s.epreuve_id === selectedEpreuveId || s.epreuveId === selectedEpreuveId
      );
      setExistingSlots(filtered);
    } catch (e) {
      console.error(e);
      toast("Erreur lors du chargement des créneaux", "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateSlot(date: string, startTime: string, roomName: string) {
    const endTime = addMinutesToTime(startTime, durationMinutes);
    
    try {
      setLoading(true);
      await api.post("/slots", {
        epreuveId: selectedEpreuveId,
        date,
        startTime,
        endTime,
        durationMinutes,
        room: roomName,
        tour: epreuve?.tour || 1,
        maxCandidates: epreuve?.isGroupEpreuve ? (epreuve?.groupSize || 1) : 1,
        minMembers: epreuve?.minEvaluatorsPerSalle || epreuve?.min_evaluators_per_salle || 2,
      });
      toast(`Créneau créé : ${startTime} - ${endTime}`, "success");
      fetchSlots();
      onUpdate();
    } catch (error: any) {
      toast(error.response?.data?.error || "Erreur création du créneau", "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleMoveSlot(slotId: string, newStartTime: string, newEndTime: string) {
    try {
      setLoading(true);
      await api.put(`/slots/${slotId}`, {
        startTime: newStartTime,
        endTime: newEndTime,
      });
      toast(`Créneau déplacé : ${newStartTime} - ${newEndTime}`, "success");
      fetchSlots();
      onUpdate();
    } catch (error: any) {
      toast(error.response?.data?.error || "Erreur déplacement", "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteSlot(slotId: string) {
    if (!window.confirm("Supprimer ce créneau définitivement ?")) return;
    try {
      setLoading(true);
      await api.delete(`/slots/${slotId}`);
      toast("Créneau supprimé", "success");
      fetchSlots();
      onUpdate();
    } catch (e) {
      toast("Erreur suppression", "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleRenameRoom(roomNum: number, newName: string) {
    const oldName = getRoomName(roomNum);
    if (!newName.trim() || newName.trim() === oldName) {
      setEditingRoom(null);
      return;
    }
    
    try {
      setLoading(true);
      // Update all slots with this room name
      const slotsToUpdate = existingSlots.filter(s => s.room === oldName);
      for (const slot of slotsToUpdate) {
        await api.put(`/slots/${slot.id}`, { room: newName.trim() });
      }
      setRoomNames(prev => ({ ...prev, [roomNum]: newName.trim() }));
      setEditingRoom(null);
      toast(`Salle renommée en "${newName.trim()}"`, "success");
      fetchSlots();
    } catch (e) {
      toast("Erreur renommage", "error");
    } finally {
      setLoading(false);
    }
  }

  // ─── Guard ───────────────────────────────────────────────────────────
  if (!epreuve) return null;

  if (validDays.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
        <p className="text-gray-500 mb-2">Les dates de cette épreuve ne semblent pas configurées.</p>
        <p className="text-sm text-gray-400">Veuillez paramétrer l&apos;épreuve dans les Réglages (Date de début et fin).</p>
      </div>
    );
  }

  // ─── Build events for the active day ─────────────────────────────────
  const currentDaySlots = existingSlots.filter(
    s => (s.date || "").split("T")[0] === activeTabDay
  );

  function buildEventsForRoom(roomName: string, colorIndex: number): EventInput[] {
    const roomSlots = currentDaySlots.filter(s => s.room === roomName);
    return roomSlots.map(slot => {
      const startTime = slot.start_time || slot.startTime || "08:00";
      const endTime = slot.end_time || slot.endTime || "09:00";
      const color = ROOM_COLORS[colorIndex % ROOM_COLORS.length];
      
      return {
        id: slot.id,
        title: `${startTime} - ${endTime}`,
        start: `${activeTabDay}T${startTime}:00`,
        end: `${activeTabDay}T${endTime}:00`,
        backgroundColor: color.bg,
        borderColor: color.border,
        textColor: color.text,
        extendedProps: {
          slotId: slot.id,
          roomName,
          status: slot.status,
          duration: slot.duration_minutes || slot.durationMinutes || durationMinutes,
        },
      };
    });
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
      {/* HEADER */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-gray-900">📅 Calendar Builder</h2>
          {loading && <span className="text-xs text-blue-600 animate-pulse">Synchronisation...</span>}
        </div>
        <div className="flex items-center gap-2">
          {/* Info badge */}
          <span className="text-[11px] text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
            {durationMinutes}min + {roulementMinutes}min roulement = {totalSlotDuration}min/créneau
          </span>
          {/* Config toggle */}
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="Paramètres du calendrier"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M10 13a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M17.4 12.5a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V18a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H8a1.65 1.65 0 001-1.51V2a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V8a1.65 1.65 0 001.51 1H18a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
          </button>
        </div>
      </div>

      {/* CONFIG PANEL */}
      {showConfig && (
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/80 flex items-center gap-6">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">Début :</label>
            <input
              type="time"
              value={slotMinTime.slice(0, 5)}
              onChange={e => setSlotMinTime(e.target.value + ":00")}
              className="border border-gray-300 rounded-md px-2 py-1 text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">Fin :</label>
            <input
              type="time"
              value={slotMaxTime.slice(0, 5)}
              onChange={e => setSlotMaxTime(e.target.value + ":00")}
              className="border border-gray-300 rounded-md px-2 py-1 text-xs"
            />
          </div>
          <span className="text-[10px] text-gray-400">Plage horaire visible du calendrier</span>
        </div>
      )}

      {/* TABS JOURS */}
      <div className="flex border-b border-gray-100 bg-gray-50/50 px-2 pt-2 gap-1 overflow-x-auto">
        {validDays.map(day => {
          const isActive = activeTabDay === day;
          const daySlotCount = existingSlots.filter(s => (s.date || "").split("T")[0] === day).length;
          return (
            <button
              key={day}
              onClick={() => setActiveTabDay(day)}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2 flex items-center gap-2 ${
                isActive
                  ? "bg-white text-blue-600 border-blue-600 shadow-[0_-2px_4px_rgba(0,0,0,0.02)]"
                  : "text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-100"
              }`}
            >
              {formatDateFr(day)}
              {daySlotCount > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                  isActive ? "bg-blue-100 text-blue-700" : "bg-gray-200 text-gray-600"
                }`}>
                  {daySlotCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* CALENDAR GRID — one FullCalendar per room, side by side */}
      <div className="p-4 flex-1 bg-gray-50/30">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-lg font-medium text-gray-900">
              Planning du {formatDateFr(activeTabDay)}
            </h3>
            <p className="text-sm text-gray-500">
              Cliquez pour créer un créneau · Glissez pour le déplacer (snap 5min)
            </p>
          </div>
        </div>

        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${nbSalles}, minmax(0, 1fr))` }}
        >
          {sallesArray.map((roomNum, idx) => {
            const roomName = getRoomName(roomNum);
            const color = ROOM_COLORS[idx % ROOM_COLORS.length];
            const events = buildEventsForRoom(roomName, idx);

            return (
              <div key={roomNum} className="flex flex-col bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                {/* Room header with rename */}
                <div
                  className="px-4 py-3 border-b border-gray-200 flex items-center justify-between"
                  style={{ backgroundColor: color.bg + "60" }}
                >
                  {editingRoom === roomNum ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        autoFocus
                        value={tempRoomName}
                        onChange={e => setTempRoomName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") handleRenameRoom(roomNum, tempRoomName);
                          if (e.key === "Escape") setEditingRoom(null);
                        }}
                        className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Nom de la salle"
                      />
                      <button
                        onClick={() => handleRenameRoom(roomNum, tempRoomName)}
                        className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => setEditingRoom(null)}
                        className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <>
                      <h4 className="font-semibold text-gray-700 text-center flex-1">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full mr-2"
                          style={{ backgroundColor: color.border }}
                        />
                        {roomName}
                      </h4>
                      <button
                        onClick={() => {
                          setEditingRoom(roomNum);
                          setTempRoomName(roomName);
                        }}
                        className="text-gray-400 hover:text-gray-600 transition-colors p-1"
                        title="Renommer la salle"
                      >
                        <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                          <path d="M13.586 3.586a2 2 0 112.828 2.828l-8.793 8.794-3.536.707.707-3.536 8.794-8.793z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </>
                  )}
                </div>

                {/* FullCalendar instance for this room */}
                <div className="calendar-room-grid" style={{ minHeight: 500 }}>
                  <RoomCalendar
                    key={`${activeTabDay}-${roomNum}-${events.length}`}
                    activeDay={activeTabDay}
                    roomName={roomName}
                    roomIndex={idx}
                    events={events}
                    slotMinTime={slotMinTime}
                    slotMaxTime={slotMaxTime}
                    durationMinutes={durationMinutes}
                    totalSlotDuration={totalSlotDuration}
                    onCreateSlot={(startTime) => handleCreateSlot(activeTabDay, startTime, roomName)}
                    onMoveSlot={(slotId, newStart, newEnd) => handleMoveSlot(slotId, newStart, newEnd)}
                    onDeleteSlot={handleDeleteSlot}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 flex items-center gap-4 text-[11px] text-gray-500">
        <span className="font-medium text-gray-600">Légende :</span>
        {sallesArray.map((roomNum, idx) => {
          const color = ROOM_COLORS[idx % ROOM_COLORS.length];
          return (
            <span key={roomNum} className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded" style={{ backgroundColor: color.bg, border: `2px solid ${color.border}` }} />
              {getRoomName(roomNum)}
            </span>
          );
        })}
        <span className="ml-auto text-gray-400">
          {currentDaySlots.length} créneau{currentDaySlots.length !== 1 ? "x" : ""} ce jour
        </span>
      </div>

      {/* Global CSS overrides for FullCalendar inside this component */}
      <style jsx global>{`
        .calendar-room-grid .fc {
          font-family: inherit;
          border: none;
        }
        .calendar-room-grid .fc .fc-timegrid-col-events {
          margin: 0 2px;
        }
        .calendar-room-grid .fc .fc-timegrid-event {
          border-radius: 6px;
          border-left-width: 3px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
          cursor: grab;
          transition: box-shadow 0.15s, transform 0.15s;
          padding: 2px 4px;
        }
        .calendar-room-grid .fc .fc-timegrid-event:hover {
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          transform: scale(1.02);
        }
        .calendar-room-grid .fc .fc-timegrid-event:active {
          cursor: grabbing;
        }
        .calendar-room-grid .fc .fc-event-title {
          font-weight: 600;
          font-size: 11px;
        }
        .calendar-room-grid .fc .fc-col-header {
          display: none;
        }
        .calendar-room-grid .fc .fc-timegrid-slot {
          height: 20px;
          border-color: #f3f4f6;
        }
        .calendar-room-grid .fc .fc-timegrid-slot-minor {
          border-top-style: dotted;
          border-color: #f9fafb;
        }
        .calendar-room-grid .fc .fc-timegrid-axis {
          font-size: 10px;
          color: #9ca3af;
          font-weight: 500;
        }
        .calendar-room-grid .fc .fc-timegrid-now-indicator-line {
          border-color: #EF4444;
          border-width: 2px;
        }
        .calendar-room-grid .fc .fc-scrollgrid {
          border: none;
        }
        .calendar-room-grid .fc td, .calendar-room-grid .fc th {
          border-color: #f3f4f6;
        }
        .calendar-room-grid .fc .fc-timegrid-event .fc-event-main {
          padding: 2px 4px;
          overflow: hidden;
        }
        .calendar-room-grid .fc .fc-highlight {
          background-color: rgba(59, 130, 246, 0.12);
        }
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
        .calendar-room-grid .fc .fc-timegrid-event:hover .fc-event-delete-btn {
          display: flex;
        }
      `}</style>
    </div>
  );
}

// ─── Sub-component: Individual room calendar ─────────────────────────
interface RoomCalendarProps {
  activeDay: string;
  roomName: string;
  roomIndex: number;
  events: EventInput[];
  slotMinTime: string;
  slotMaxTime: string;
  durationMinutes: number;
  totalSlotDuration: number;
  onCreateSlot: (startTime: string) => void;
  onMoveSlot: (slotId: string, newStart: string, newEnd: string) => void;
  onDeleteSlot: (slotId: string) => void;
}

function RoomCalendar({
  activeDay,
  roomName,
  roomIndex,
  events,
  slotMinTime,
  slotMaxTime,
  durationMinutes,
  totalSlotDuration,
  onCreateSlot,
  onMoveSlot,
  onDeleteSlot,
}: RoomCalendarProps) {
  const calendarRef = useRef<FullCalendar>(null);

  // Navigate to the active day when it changes
  useEffect(() => {
    if (calendarRef.current) {
      const calendarApi = calendarRef.current.getApi();
      calendarApi.gotoDate(activeDay);
    }
  }, [activeDay]);

  // Handle click on empty time slot → create
  const handleDateClick = useCallback((info: any) => {
    const clickedDate = info.date as Date;
    const hours = clickedDate.getHours().toString().padStart(2, "0");
    const minutes = clickedDate.getMinutes().toString().padStart(2, "0");
    const startTime = `${hours}:${minutes}`;
    onCreateSlot(startTime);
  }, [onCreateSlot]);

  // Handle drag & drop of existing events  
  const handleEventDrop = useCallback((info: EventDropArg) => {
    const event = info.event;
    const slotId = event.extendedProps?.slotId || event.id;
    
    if (!event.start) {
      info.revert();
      return;
    }
    
    const newStart = event.start;
    const newStartTime = `${newStart.getHours().toString().padStart(2, "0")}:${newStart.getMinutes().toString().padStart(2, "0")}`;
    const newEndTime = addMinutesToTime(newStartTime, durationMinutes);
    
    onMoveSlot(slotId, newStartTime, newEndTime);
  }, [onMoveSlot, durationMinutes]);

  // Handle click on existing event → show delete option
  const handleEventClick = useCallback((info: EventClickArg) => {
    // Check if delete button was clicked
    const target = info.jsEvent?.target as HTMLElement;
    if (target?.classList?.contains("fc-event-delete-btn")) {
      const slotId = info.event.extendedProps?.slotId || info.event.id;
      onDeleteSlot(slotId);
    }
  }, [onDeleteSlot]);

  // Custom event rendering with delete button
  const renderEventContent = useCallback((eventInfo: any) => {
    const startStr = eventInfo.event.start?.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) || "";
    const endStr = eventInfo.event.end?.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) || "";
    const status = eventInfo.event.extendedProps?.status;
    const dur = eventInfo.event.extendedProps?.duration;
    
    return (
      <div className="relative w-full h-full p-0.5">
        <button
          className="fc-event-delete-btn"
          onClick={(e) => {
            e.stopPropagation();
            const slotId = eventInfo.event.extendedProps?.slotId || eventInfo.event.id;
            onDeleteSlot(slotId);
          }}
          title="Supprimer"
        >
          ✕
        </button>
        <div className="text-[11px] font-bold leading-tight">{startStr} - {endStr}</div>
        <div className="text-[9px] opacity-70 mt-0.5">
          {dur}min
          {status && status !== "open" && (
            <span className="ml-1 uppercase font-semibold">{status}</span>
          )}
        </div>
      </div>
    );
  }, [onDeleteSlot]);

  return (
    <FullCalendar
      ref={calendarRef}
      plugins={[timeGridPlugin, interactionPlugin]}
      initialView="timeGridDay"
      initialDate={activeDay}
      headerToolbar={false}
      allDaySlot={false}
      slotMinTime={slotMinTime}
      slotMaxTime={slotMaxTime}
      slotDuration="00:05:00"
      snapDuration="00:05:00"
      slotLabelInterval="01:00:00"
      slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
      height="auto"
      expandRows={true}
      editable={true}
      droppable={false}
      eventDurationEditable={false}
      eventStartEditable={true}
      selectable={false}
      dateClick={handleDateClick}
      eventDrop={handleEventDrop}
      eventClick={handleEventClick}
      eventContent={renderEventContent}
      events={events}
      nowIndicator={true}
      dayHeaders={false}
    />
  );
}
