"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";
import {
  Loader2, Calendar, Clock, MapPin, ChevronLeft, ChevronRight,
  X as XIcon, AlertTriangle, Bell, BookOpen, DoorOpen,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════ */
interface CalendarEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  startTime?: string;
  endTime?: string;
  type: "commune" | "individuelle" | "global";
  room?: string;
  description?: string;
  // Enrollment-specific fields
  slotId?: string;
  enrolledAt?: string;
  tour?: number;
  canCancel?: boolean; // true if > 24h before start
}

/* ═══════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════ */
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
  return day === 0 ? 6 : day - 1;
}

function canCancelSlot(dateStr: string, startTime?: string): boolean {
  if (!dateStr) return false;
  try {
    const d = new Date(dateStr);
    const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const time = startTime ? startTime.slice(0, 5) : "00:00";
    const slotStart = new Date(`${dStr}T${time}:00`);
    const now = new Date();
    const hoursUntil = (slotStart.getTime() - now.getTime()) / (1000 * 60 * 60);
    return hoursUntil >= 24;
  } catch {
    return false;
  }
}

function formatTimeRemaining(dateStr: string, startTime?: string): string {
  try {
    const d = new Date(dateStr);
    const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const time = startTime ? startTime.slice(0, 5) : "00:00";
    const slotStart = new Date(`${dStr}T${time}:00`);
    const now = new Date();
    const hoursUntil = (slotStart.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntil < 0) return "Passé";
    if (hoursUntil < 1) return `${Math.round(hoursUntil * 60)}min`;
    if (hoursUntil < 24) return `${Math.round(hoursUntil)}h`;
    const days = Math.floor(hoursUntil / 24);
    return `${days}j ${Math.round(hoursUntil % 24)}h`;
  } catch {
    return "";
  }
}

type ViewMode = "month" | "week";

/* ═══════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════ */
export default function CandidateCalendarPage() {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    try {
      const [calRes, enrollRes] = await Promise.all([
        api.get("/calendar"),
        api.get("/slots/my-enrollments").catch(() => ({ data: [] })),
      ]);

      const calEvents: CalendarEvent[] = (calRes.data || []).map((ev: any) => {
        let dateStr = "";
        if (ev.day) {
          const d = new Date(ev.day);
          dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        }

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
          room: ev.epreuve?.salle || ev.room || null,
          description: ev.description || null,
        };
      });

      // Map enrolled slots as calendar events
      const slotEvents: CalendarEvent[] = (enrollRes.data || []).map((e: any) => {
        const dateRaw = e.date || "";
        let dateStr = "";
        if (dateRaw) {
          const d = new Date(dateRaw);
          dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        }
        const startTime = e.startTime || null;
        const endTime = e.endTime || null;

        return {
          id: `enrollment-${e.id}`,
          title: e.epreuve?.name || "Créneau réservé",
          date: dateStr,
          startTime,
          endTime,
          type: "individuelle" as const,
          room: e.room || null,
          description: `Tour ${e.epreuve?.tour || "?"}`,
          slotId: e.slotId,
          enrolledAt: e.enrolledAt,
          tour: e.epreuve?.tour,
          canCancel: canCancelSlot(dateRaw, startTime),
        };
      });

      // Merge without duplicates
      const existing = new Set(calEvents.map((e) => `${e.title}-${e.date}`));
      const unique = slotEvents.filter((e) => !existing.has(`${e.title}-${e.date}`));
      setEvents([...calEvents, ...unique]);
    } catch (err) {
      console.error("Erreur chargement calendrier:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Re-check canCancel every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setEvents((prev) =>
        prev.map((ev) =>
          ev.slotId
            ? { ...ev, canCancel: canCancelSlot(ev.date, ev.startTime || undefined) }
            : ev
        )
      );
    }, 60000);
    return () => clearInterval(interval);
  }, []);

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

  // Month grid cells
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  // Week view
  const getWeekDates = () => {
    const d = new Date(currentDate);
    const dayOfWeek = d.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(d);
    monday.setDate(d.getDate() + diff);
    const dates: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const wd = new Date(monday);
      wd.setDate(monday.getDate() + i);
      dates.push(wd);
    }
    return dates;
  };
  const weekDates = getWeekDates();

  const prevWeek = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - 7);
    setCurrentDate(d);
  };
  const nextWeek = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + 7);
    setCurrentDate(d);
  };

  const getEventsForDate = (date: Date) => {
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return events.filter((e) => e.date === dateStr);
  };

  // Cancel enrollment
  const handleCancel = async (slotId: string) => {
    setCancelling(true);
    setCancelError(null);
    try {
      await api.delete(`/slots/enroll/${slotId}`);
      // Remove from events
      setEvents((prev) => prev.filter((e) => e.slotId !== slotId));
      setSelectedEvent(null);
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Erreur lors de l'annulation";
      setCancelError(msg);
    } finally {
      setCancelling(false);
    }
  };

  // Upcoming events list (next 7 days)
  const upcomingEvents = useMemo(() => {
    const now = new Date();
    const in7Days = new Date(now);
    in7Days.setDate(in7Days.getDate() + 7);
    return events
      .filter((e) => {
        if (!e.date) return false;
        const d = new Date(e.date + "T00:00:00");
        return d >= now && d <= in7Days;
      })
      .sort((a, b) => {
        const da = new Date(a.date + "T" + (a.startTime || "00:00"));
        const db = new Date(b.date + "T" + (b.startTime || "00:00"));
        return da.getTime() - db.getTime();
      });
  }, [events]);

  const typeStyles: Record<string, { bg: string; text: string; dot: string; label: string }> = {
    commune: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500", label: "Épreuve commune" },
    global: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500", label: "Événement global" },
    individuelle: { bg: "bg-rose-50", text: "text-rose-700", dot: "bg-rose-500", label: "Créneau personnel" },
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mon calendrier</h1>
        <p className="text-sm text-gray-500 mt-1">Vos épreuves, créneaux d&apos;évaluation et événements</p>
      </div>

      {/* Upcoming events banner */}
      {upcomingEvents.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3">
            <Bell size={15} className="text-blue-500" />
            Prochains événements (7 jours)
          </h2>
          <div className="space-y-2">
            {upcomingEvents.slice(0, 5).map((ev) => {
              const style = typeStyles[ev.type] || typeStyles.individuelle;
              const remaining = formatTimeRemaining(ev.date, ev.startTime || undefined);
              return (
                <button
                  key={ev.id}
                  onClick={() => setSelectedEvent(ev)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                >
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${style.dot}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{ev.title}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(ev.date + "T12:00:00").toLocaleDateString("fr-FR", {
                        weekday: "short", day: "numeric", month: "short",
                      })}
                      {ev.startTime && ` à ${ev.startTime.slice(0, 5)}`}
                    </p>
                  </div>
                  {ev.room && (
                    <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full flex-shrink-0">
                      <DoorOpen size={12} />
                      {ev.room}
                    </span>
                  )}
                  <span className="text-xs font-medium text-gray-400 flex-shrink-0">
                    dans {remaining}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Controls row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={viewMode === "month" ? prevMonth : prevWeek}
            className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-lg font-semibold text-gray-900 min-w-[180px] text-center">
            {viewMode === "month"
              ? `${MONTHS[month]} ${year}`
              : `${weekDates[0].toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} - ${weekDates[6].toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}`
            }
          </span>
          <button
            onClick={viewMode === "month" ? nextMonth : nextWeek}
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

        <div className="flex bg-gray-100 rounded-full p-0.5">
          {(["month", "week"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${
                viewMode === mode
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {mode === "month" ? "Mois" : "Semaine"}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
          Épreuve commune
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
          Créneau personnel
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
          Événement global
        </span>
      </div>

      {/* Calendar */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="animate-spin text-blue-500" size={32} />
        </div>
      ) : (
        <>
          {/* ═══ VUE MOIS ═══ */}
          {viewMode === "month" && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-7 border-b border-gray-200">
                {DAYS.map((d) => (
                  <div key={d} className="py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {d}
                  </div>
                ))}
              </div>
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
                              isToday(day) ? "bg-blue-600 text-white" : "text-gray-700"
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
                                  onClick={() => { setCancelError(null); setSelectedEvent(ev); }}
                                  className={`w-full text-left text-[11px] leading-tight px-1.5 py-1 rounded-md truncate font-medium transition-opacity hover:opacity-80 ${style.bg} ${style.text}`}
                                  title={`${ev.title}${ev.room ? ` — Salle: ${ev.room}` : ""}${ev.startTime ? ` ${ev.startTime.slice(0, 5)}` : ""}`}
                                >
                                  {ev.startTime && (
                                    <span className="font-semibold">{ev.startTime.slice(0, 5)} </span>
                                  )}
                                  {ev.title}
                                  {ev.room && (
                                    <span className="ml-1 opacity-70">({ev.room})</span>
                                  )}
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

          {/* ═══ VUE SEMAINE ═══ */}
          {viewMode === "week" && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-7">
                {weekDates.map((wd, i) => {
                  const dateEvents = getEventsForDate(wd);
                  const isTodayDate =
                    wd.getFullYear() === today.getFullYear() &&
                    wd.getMonth() === today.getMonth() &&
                    wd.getDate() === today.getDate();
                  return (
                    <div key={i} className="border-r border-gray-100 last:border-r-0">
                      {/* Day header */}
                      <div className={`p-3 text-center border-b border-gray-200 ${isTodayDate ? "bg-blue-50" : "bg-gray-50"}`}>
                        <p className="text-xs font-semibold text-gray-500 uppercase">{DAYS[i]}</p>
                        <p className={`text-xl font-bold mt-0.5 ${isTodayDate ? "text-blue-600" : "text-gray-900"}`}>
                          {wd.getDate()}
                        </p>
                        <p className="text-xs text-gray-400">
                          {wd.toLocaleDateString("fr-FR", { month: "short" })}
                        </p>
                      </div>
                      {/* Events */}
                      <div className="p-2 min-h-[200px] space-y-1.5">
                        {dateEvents.length === 0 && (
                          <p className="text-xs text-gray-300 text-center mt-4">—</p>
                        )}
                        {dateEvents.map((ev) => {
                          const style = typeStyles[ev.type] || typeStyles.individuelle;
                          return (
                            <button
                              key={ev.id}
                              onClick={() => { setCancelError(null); setSelectedEvent(ev); }}
                              className={`w-full text-left p-2 rounded-lg border text-xs transition-all hover:shadow-sm ${style.bg} ${style.text}`}
                              style={{ borderColor: "transparent" }}
                            >
                              <p className="font-semibold truncate">{ev.title}</p>
                              {ev.startTime && (
                                <p className="mt-0.5 opacity-80">
                                  {ev.startTime.slice(0, 5)}
                                  {ev.endTime ? ` - ${ev.endTime.slice(0, 5)}` : ""}
                                </p>
                              )}
                              {ev.room && (
                                <p className="mt-0.5 flex items-center gap-0.5 opacity-70">
                                  <DoorOpen size={10} />
                                  {ev.room}
                                </p>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
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

      {/* ═══════════════════════════════════════════════
          MODALE DÉTAIL ÉVÉNEMENT + BOUTON ANNULATION
          ═══════════════════════════════════════════════ */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSelectedEvent(null)}>
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Color accent bar */}
            {(() => {
              const style = typeStyles[selectedEvent.type] || typeStyles.individuelle;
              const dotColor = selectedEvent.type === "global" ? "#3B82F6" : selectedEvent.type === "commune" ? "#F59E0B" : "#F43F5E";
              return <div className="h-2" style={{ backgroundColor: dotColor }} />;
            })()}

            <div className="px-6 py-5 space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{selectedEvent.title}</h3>
                  <span
                    className={`inline-flex items-center gap-1 mt-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      typeStyles[selectedEvent.type]?.bg || ""
                    } ${typeStyles[selectedEvent.type]?.text || ""}`}
                  >
                    {typeStyles[selectedEvent.type]?.label || "Événement"}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  <XIcon size={18} />
                </button>
              </div>

              {/* Details grid */}
              <div className="space-y-3">
                {selectedEvent.date && (
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                    <Calendar size={18} className="text-blue-500 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-gray-400 font-medium">Date</p>
                      <p className="text-sm font-semibold text-gray-900 capitalize">
                        {new Date(selectedEvent.date + "T12:00:00").toLocaleDateString("fr-FR", {
                          weekday: "long", day: "numeric", month: "long", year: "numeric",
                        })}
                      </p>
                    </div>
                  </div>
                )}

                {selectedEvent.startTime && (
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                    <Clock size={18} className="text-purple-500 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-gray-400 font-medium">Horaire</p>
                      <p className="text-sm font-semibold text-gray-900">
                        {selectedEvent.startTime.slice(0, 5)}
                        {selectedEvent.endTime && ` - ${selectedEvent.endTime.slice(0, 5)}`}
                      </p>
                    </div>
                  </div>
                )}

                {/* ═══ SALLE — RÈGLE 3 : Toujours visible ═══ */}
                {selectedEvent.room && (
                  <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl border border-blue-100">
                    <DoorOpen size={18} className="text-blue-600 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-blue-500 font-medium">Salle</p>
                      <p className="text-sm font-bold text-blue-800">{selectedEvent.room}</p>
                    </div>
                  </div>
                )}

                {selectedEvent.tour && (
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                    <BookOpen size={18} className="text-gray-500 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-gray-400 font-medium">Tour</p>
                      <p className="text-sm font-semibold text-gray-900">Tour {selectedEvent.tour}</p>
                    </div>
                  </div>
                )}

                {selectedEvent.description && (
                  <p className="text-sm text-gray-500 italic border-t border-gray-100 pt-3">
                    {selectedEvent.description}
                  </p>
                )}
              </div>

              {/* ═══ RÈGLE 1 : Bouton annulation avec vérification 24h ═══ */}
              {selectedEvent.slotId && (
                <div className="pt-2 border-t border-gray-100">
                  {cancelError && (
                    <div className="mb-3 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                      <AlertTriangle size={16} className="flex-shrink-0" />
                      {cancelError}
                    </div>
                  )}

                  {selectedEvent.canCancel ? (
                    <button
                      onClick={() => handleCancel(selectedEvent.slotId!)}
                      disabled={cancelling}
                      className="w-full py-3 text-sm font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {cancelling ? (
                        <Loader2 className="animate-spin" size={16} />
                      ) : (
                        <XIcon size={16} />
                      )}
                      {cancelling ? "Annulation..." : "Se désinscrire de ce créneau"}
                    </button>
                  ) : (
                    <div className="w-full py-3 text-sm font-medium text-center text-gray-500 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-center gap-2">
                      <AlertTriangle size={16} className="text-amber-500" />
                      <span>
                        Annulation impossible — moins de 24h avant le début
                      </span>
                    </div>
                  )}

                  <p className="text-xs text-gray-400 text-center mt-2">
                    Début dans {formatTimeRemaining(selectedEvent.date, selectedEvent.startTime || undefined)}
                    {" • "}Annulation possible jusqu&apos;à 24h avant
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
