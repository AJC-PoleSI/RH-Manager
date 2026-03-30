"use client";

import { useState, useCallback, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";
import { Loader2, Calendar, Clock, MapPin, ChevronLeft, ChevronRight } from "lucide-react";

interface CalendarEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  startTime?: string;
  endTime?: string;
  type: "commune" | "individuelle" | "global";
  room?: string;
  description?: string;
}

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTHS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1; // Monday = 0
}

type ViewMode = "month" | "week" | "day";

export default function CandidateCalendarPage() {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  const fetchEvents = useCallback(async () => {
    try {
      // Fetch calendar events from API
      const res = await api.get("/calendar");
      if (res.data && Array.isArray(res.data)) {
        const mapped: CalendarEvent[] = res.data.map((ev: any) => {
          // Extract date from `day` field (ISO string)
          let dateStr = "";
          if (ev.day) {
            const d = new Date(ev.day);
            dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          }

          // Determine type
          let type: "commune" | "individuelle" | "global" = "individuelle";
          if (ev.is_global) type = "global";
          else if (ev.epreuve?.type === "commune") type = "commune";

          return {
            id: ev.id,
            title: ev.title || ev.epreuve?.name || "Événement",
            date: dateStr,
            startTime: ev.start_time || null,
            endTime: ev.end_time || null,
            type,
            room: ev.epreuve?.salle || null,
            description: ev.description || null,
          };
        });
        setEvents(mapped);
      }

      // Also fetch enrolled slots to show as calendar events
      try {
        const enrollRes = await api.get("/slots/my-enrollments");
        if (enrollRes.data && Array.isArray(enrollRes.data)) {
          const slotEvents: CalendarEvent[] = enrollRes.data.map((e: any) => ({
            id: `enrollment-${e.id}`,
            title: e.epreuve?.name || "Créneau réservé",
            date: e.date || "",
            startTime: e.startTime || null,
            endTime: e.endTime || null,
            type: "individuelle" as const,
            room: e.room || null,
            description: `Tour ${e.epreuve?.tour || "?"}`,
          }));
          setEvents((prev) => {
            // Merge without duplicates (by title+date)
            const existing = new Set(prev.map((e) => `${e.title}-${e.date}`));
            const unique = slotEvents.filter((e) => !existing.has(`${e.title}-${e.date}`));
            return [...prev, ...unique];
          });
        }
      } catch {
        // Enrollments endpoint may not be available for all roles
      }
    } catch (err) {
      console.error("Erreur chargement calendrier:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToday = () => setCurrentDate(new Date());

  const getEventsForDay = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return events.filter((e) => e.date === dateStr);
  };

  const today = new Date();
  const isToday = (day: number) =>
    today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

  // Build calendar grid cells
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const typeStyles: Record<string, { bg: string; text: string; dot: string }> = {
    commune: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
    global: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
    individuelle: { bg: "bg-rose-50", text: "text-rose-700", dot: "bg-rose-500" },
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mon calendrier</h1>
        <p className="text-sm text-gray-500 mt-1">Vos épreuves et créneaux d&apos;évaluation</p>
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-between">
        {/* Month navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={prevMonth}
            className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-lg font-semibold text-gray-900 min-w-[180px] text-center">
            {MONTHS[month]} {year}
          </span>
          <button
            onClick={nextMonth}
            className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={goToday}
            className="ml-2 px-3 py-1 text-xs font-medium bg-blue-50 text-blue-700 rounded-full hover:bg-blue-100 transition-colors"
          >
            Aujourd&apos;hui
          </button>
        </div>

        {/* View toggle */}
        <div className="flex bg-gray-100 rounded-full p-0.5">
          {(["month", "week", "day"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${
                viewMode === mode
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {mode === "month" ? "Mois" : mode === "week" ? "Semaine" : "Jour"}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
          Épreuve commune (Sur table)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
          Créneau personnel
        </span>
      </div>

      {/* Calendar grid */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="animate-spin text-blue-500" size={32} />
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-gray-200">
            {DAYS.map((d) => (
              <div key={d} className="py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7">
            {cells.map((day, i) => {
              const dayEvents = day ? getEventsForDay(day) : [];
              return (
                <div
                  key={i}
                  className={`min-h-[100px] border-b border-r border-gray-100 p-1.5 ${
                    day === null ? "bg-gray-50/50" : "bg-white"
                  } ${i % 7 === 6 ? "border-r-0" : ""}`}
                >
                  {day !== null && (
                    <>
                      <div
                        className={`text-sm font-medium mb-1 w-7 h-7 flex items-center justify-center rounded-full ${
                          isToday(day)
                            ? "bg-blue-600 text-white"
                            : "text-gray-700"
                        }`}
                      >
                        {day}
                      </div>
                      <div className="space-y-0.5">
                        {dayEvents.map((ev) => {
                          const style = typeStyles[ev.type] || typeStyles.individuelle;
                          return (
                            <button
                              key={ev.id}
                              onClick={() => setSelectedEvent(ev)}
                              className={`w-full text-left text-[11px] leading-tight px-1.5 py-1 rounded-md truncate font-medium transition-opacity hover:opacity-80 ${style.bg} ${style.text}`}
                              title={`${ev.title} ${ev.startTime || ""}${ev.endTime ? " - " + ev.endTime : ""}`}
                            >
                              {ev.startTime && (
                                <span className="font-semibold">{ev.startTime.slice(0, 5)} </span>
                              )}
                              {ev.title}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {events.length === 0 && !loading && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <Calendar className="mx-auto text-gray-300 mb-3" size={40} />
          <p className="text-gray-500 font-medium">Aucun événement prévu</p>
          <p className="text-sm text-gray-400 mt-1">
            Vos épreuves et créneaux apparaîtront ici une fois planifiés.
          </p>
        </div>
      )}

      {/* Event detail modal */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setSelectedEvent(null)}>
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <h3 className="text-lg font-bold text-gray-900">{selectedEvent.title}</h3>
              <button
                onClick={() => setSelectedEvent(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                &times;
              </button>
            </div>

            <div className="space-y-3 text-sm text-gray-600">
              {selectedEvent.date && (
                <div className="flex items-center gap-2">
                  <Calendar size={16} className="text-gray-400" />
                  <span className="capitalize">
                    {new Date(selectedEvent.date + "T12:00:00").toLocaleDateString("fr-FR", {
                      weekday: "long", day: "numeric", month: "long", year: "numeric"
                    })}
                  </span>
                </div>
              )}
              {selectedEvent.startTime && (
                <div className="flex items-center gap-2">
                  <Clock size={16} className="text-gray-400" />
                  <span>
                    {selectedEvent.startTime.slice(0, 5)}
                    {selectedEvent.endTime && ` - ${selectedEvent.endTime.slice(0, 5)}`}
                  </span>
                </div>
              )}
              {selectedEvent.room && (
                <div className="flex items-center gap-2">
                  <MapPin size={16} className="text-gray-400" />
                  <span>{selectedEvent.room}</span>
                </div>
              )}
              {selectedEvent.description && (
                <p className="text-gray-500 italic border-t border-gray-100 pt-3 mt-3">
                  {selectedEvent.description}
                </p>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <span
                className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${
                  selectedEvent.type === "individuelle"
                    ? "bg-rose-50 text-rose-700"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                {selectedEvent.type === "individuelle" ? "Créneau personnel" : "Épreuve commune"}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
