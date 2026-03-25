"use client";

import { useState, useCallback, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";

interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  type: "commune" | "individuelle";
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

const DEMO_EVENTS: CalendarEvent[] = [
  { id: "1", title: "Épreuve commune - Culture générale", date: "2026-04-06", startTime: "09:00", endTime: "12:00", type: "commune" },
  { id: "2", title: "Entretien individuel", date: "2026-04-10", startTime: "14:00", endTime: "14:30", type: "individuelle" },
  { id: "3", title: "Épreuve commune - Anglais", date: "2026-04-15", startTime: "10:00", endTime: "12:00", type: "commune" },
  { id: "4", title: "Oral de motivation", date: "2026-04-22", startTime: "11:00", endTime: "11:30", type: "individuelle" },
  { id: "5", title: "Épreuve commune - Logique", date: "2026-04-28", startTime: "09:00", endTime: "11:00", type: "commune" },
];

type ViewMode = "month" | "week" | "day";

export default function CandidateCalendarPage() {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [currentDate, setCurrentDate] = useState(new Date(2026, 3, 1)); // April 2026
  const [events, setEvents] = useState<CalendarEvent[]>(DEMO_EVENTS);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await api.get("/calendar");
      if (res.data && Array.isArray(res.data) && res.data.length > 0) {
        setEvents(res.data);
      }
    } catch {
      // Use demo data on failure
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

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mon calendrier</h1>
        <p className="text-sm text-gray-500 mt-1">Vos épreuves et formations</p>
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-between">
        {/* Month navigation */}
        <div className="flex items-center gap-3">
          <button
            onClick={prevMonth}
            className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50 text-gray-600"
          >
            &#8249;
          </button>
          <span className="text-lg font-semibold text-gray-900 min-w-[180px] text-center">
            {MONTHS[month]} {year}
          </span>
          <button
            onClick={nextMonth}
            className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50 text-gray-600"
          >
            &#8250;
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
          <span className="w-2.5 h-2.5 rounded-full bg-[#2563EB]" />
          Épreuve commune
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#E8446A]" />
          Créneau personnel
        </span>
      </div>

      {/* Calendar grid */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-[10px] overflow-hidden">
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
                    day === null ? "bg-gray-50" : "bg-white"
                  } ${i % 7 === 6 ? "border-r-0" : ""}`}
                >
                  {day !== null && (
                    <>
                      <div
                        className={`text-sm font-medium mb-1 w-7 h-7 flex items-center justify-center rounded-full ${
                          isToday(day)
                            ? "bg-[#2563EB] text-white"
                            : "text-gray-700"
                        }`}
                      >
                        {day}
                      </div>
                      <div className="space-y-0.5">
                        {dayEvents.map((ev) => (
                          <div
                            key={ev.id}
                            className={`text-[11px] leading-tight px-1.5 py-1 rounded-md truncate font-medium ${
                              ev.type === "commune"
                                ? "bg-[#EFF6FF] text-[#2563EB]"
                                : "bg-[#FFF0F3] text-[#E8446A]"
                            }`}
                            title={`${ev.title} ${ev.startTime || ""}${ev.endTime ? " - " + ev.endTime : ""}`}
                          >
                            {ev.startTime && (
                              <span className="font-semibold">{ev.startTime} </span>
                            )}
                            {ev.title}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
