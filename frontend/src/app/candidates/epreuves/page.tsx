"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";
import {
  Loader2, Calendar, MapPin, FileText, Clock,
  ChevronDown, ChevronUp, Users, BookOpen, X,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════ */
interface Epreuve {
  id: string;
  name: string;
  type: "commune" | "individuelle" | "groupe";
  tour: number;
  durationMinutes?: number;
  description?: string | null;
  documentsUrls?: string[];
  date?: string | null;
  time?: string | null;
  salle?: string | null;
  presentedBy?: string | null;
  dateDebut?: string | null;
  dateFin?: string | null;
  registrationOpen?: boolean;
}

interface AvailableSlot {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  room?: string;
  label?: string;
  enrolledCount: number;
  maxCandidates: number;
  isFull: boolean;
  isEnrolled: boolean;
  epreuve?: { id?: string; name: string; tour: number; type?: string; durationMinutes?: number } | null;
}

/* ═══════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════ */
const TOUR_LABELS = ["Tour 1", "Tour 2", "Tour 3"];

const TYPE_STYLES: Record<string, { bg: string; text: string; border: string; label: string; icon: string }> = {
  commune: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", label: "Sur table", icon: "📝" },
  individuelle: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", label: "Individuelle", icon: "👤" },
  groupe: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", label: "Groupe", icon: "👥" },
};

const EPREUVE_COLORS = [
  { bg: "bg-blue-100", text: "text-blue-800", border: "border-blue-300", accent: "#3B82F6" },
  { bg: "bg-purple-100", text: "text-purple-800", border: "border-purple-300", accent: "#8B5CF6" },
  { bg: "bg-pink-100", text: "text-pink-800", border: "border-pink-300", accent: "#EC4899" },
  { bg: "bg-teal-100", text: "text-teal-800", border: "border-teal-300", accent: "#14B8A6" },
  { bg: "bg-orange-100", text: "text-orange-800", border: "border-orange-300", accent: "#F97316" },
  { bg: "bg-indigo-100", text: "text-indigo-800", border: "border-indigo-300", accent: "#6366F1" },
  { bg: "bg-cyan-100", text: "text-cyan-800", border: "border-cyan-300", accent: "#06B6D4" },
  { bg: "bg-rose-100", text: "text-rose-800", border: "border-rose-300", accent: "#F43F5E" },
];

const DAYS_FR = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const DAYS_SHORT = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

function formatDateFr(dateStr?: string | null) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function formatDateShort(dateStr: string) {
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  } catch {
    return dateStr;
  }
}

function formatTime(timeStr?: string | null) {
  if (!timeStr) return "";
  return timeStr.slice(0, 5);
}

function timeToMinutes(t: string): number {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + (m || 0);
}

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
}

/* ═══════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════ */
export default function CandidateEpreuvesPage() {
  const { user } = useAuth();
  const [epreuves, setEpreuves] = useState<Epreuve[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [enrolledEpreuves, setEnrolledEpreuves] = useState<Set<string>>(new Set());
  const [enrolledSlotIds, setEnrolledSlotIds] = useState<Set<string>>(new Set());

  // Calendar data
  const [allSlots, setAllSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);

  // Detail modal
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);

  // View toggle
  const [viewMode, setViewMode] = useState<"epreuves" | "calendrier">("calendrier");

  // Error toast
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [epRes, enrollRes, slotsRes] = await Promise.all([
          api.get("/epreuves"),
          api.get("/slots/my-enrollments").catch(() => ({ data: [] })),
          api.get("/slots/available").catch(() => ({ data: [] })),
        ]);

        if (epRes.data && Array.isArray(epRes.data)) {
          // Phase 4: Only show visible epreuves to candidates
          setEpreuves(epRes.data.filter((e: any) => e.isVisible !== false));
        }

        // Track enrolled épreuves + slot IDs
        const enrolled = new Set<string>();
        const enrolledIds = new Set<string>();
        (enrollRes.data || []).forEach((e: any) => {
          if (e.slotId) enrolledIds.add(e.slotId);
          if (e.epreuve?.name) {
            const matchedEp = (epRes.data || []).find((ep: any) => ep.name === e.epreuve.name);
            if (matchedEp) enrolled.add(matchedEp.id);
          }
        });
        setEnrolledEpreuves(enrolled);
        setEnrolledSlotIds(enrolledIds);

        // Set all available slots
        setAllSlots(slotsRes.data || []);
      } catch (err) {
        console.error("Erreur chargement épreuves:", err);
      } finally {
        setLoading(false);
        setSlotsLoading(false);
      }
    };
    fetchData();
  }, []);

  // Active tour
  const activeTour = useMemo(() => {
    const now = new Date();
    const toursWithFutureEpreuves = epreuves
      .filter((e) => {
        const dateStr = e.date || e.dateFin || e.dateDebut;
        if (!dateStr) return true;
        return new Date(dateStr + "T23:59:59") >= now;
      })
      .map((e) => e.tour);
    if (toursWithFutureEpreuves.length === 0) {
      return Math.max(...epreuves.map((e) => e.tour), 1);
    }
    return Math.min(...toursWithFutureEpreuves);
  }, [epreuves]);

  const tours = Array.from(new Set(epreuves.map((e) => e.tour))).sort();
  if (tours.length === 0) tours.push(1, 2, 3);

  const epreuvesByTour = tours.map((t) => ({
    tour: t,
    items: epreuves.filter((e) => e.tour === t),
  }));

  // ═══ Epreuve color mapping ═══
  const epreuveColorMap = useMemo(() => {
    const map = new Map<string, (typeof EPREUVE_COLORS)[0]>();
    const uniqueNames = Array.from(new Set(allSlots.map((s) => s.epreuve?.name || "").filter(Boolean)));
    uniqueNames.forEach((name, i) => {
      map.set(name, EPREUVE_COLORS[i % EPREUVE_COLORS.length]);
    });
    return map;
  }, [allSlots]);

  // ═══ Calendar grid computation ═══
  const calendarData = useMemo(() => {
    if (allSlots.length === 0) return null;

    // Get unique dates sorted
    const dates = Array.from(new Set(allSlots.map((s) => {
      const d = s.date?.split("T")[0];
      return d || "";
    }).filter(Boolean))).sort();

    if (dates.length === 0) return null;

    // Get time range
    const allStartMinutes = allSlots.map((s) => timeToMinutes(s.startTime));
    const allEndMinutes = allSlots.map((s) => timeToMinutes(s.endTime));
    const minTime = Math.floor(Math.min(...allStartMinutes) / 60) * 60; // Round down to hour
    const maxTime = Math.ceil(Math.max(...allEndMinutes) / 60) * 60; // Round up to hour

    // Generate time rows (every 30 min)
    const timeRows: string[] = [];
    for (let t = minTime; t < maxTime; t += 30) {
      timeRows.push(minutesToTime(t));
    }

    // Build slot map: date → time → slots
    const slotMap = new Map<string, Map<string, AvailableSlot[]>>();
    dates.forEach((d) => slotMap.set(d, new Map()));

    allSlots.forEach((slot) => {
      const d = slot.date?.split("T")[0] || "";
      const dateMap = slotMap.get(d);
      if (!dateMap) return;

      // Find the closest time row
      const slotStart = timeToMinutes(slot.startTime);
      const closestRow = timeRows.reduce((prev, curr) => {
        return Math.abs(timeToMinutes(curr) - slotStart) < Math.abs(timeToMinutes(prev) - slotStart) ? curr : prev;
      });

      if (!dateMap.has(closestRow)) dateMap.set(closestRow, []);
      dateMap.get(closestRow)!.push(slot);
    });

    return { dates, timeRows, slotMap, minTime, maxTime };
  }, [allSlots]);

  // ═══ Enrollment handler ═══
  const handleEnrollInSlot = async (slot: AvailableSlot) => {
    const epreuveId = epreuves.find((ep) => ep.name === slot.epreuve?.name)?.id;
    setEnrolling(slot.id);
    setErrorMsg(null);
    try {
      await api.post("/slots/enroll", { slotId: slot.id });
      setEnrolledSlotIds((prev) => new Set(prev).add(slot.id));
      if (epreuveId) {
        setEnrolledEpreuves((prev) => new Set(prev).add(epreuveId));
      }
      // Update slot in allSlots
      setAllSlots((prev) =>
        prev.map((s) =>
          s.id === slot.id ? { ...s, isEnrolled: true, enrolledCount: s.enrolledCount + 1 } : s
        )
      );
      setSelectedSlot(null);
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Erreur lors de l'inscription";
      setErrorMsg(msg);
    } finally {
      setEnrolling(null);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  // ═══ RENDER ═══
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Épreuves & Tours</h1>
          <p className="text-sm text-gray-500 mt-1">
            Votre parcours de recrutement — consultez et inscrivez-vous aux épreuves
          </p>
        </div>
        {/* View toggle */}
        <div className="flex bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode("calendrier")}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-1.5 ${
              viewMode === "calendrier" ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <Calendar size={15} />
            Calendrier
          </button>
          <button
            onClick={() => setViewMode("epreuves")}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-1.5 ${
              viewMode === "epreuves" ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <BookOpen size={15} />
            Épreuves
          </button>
        </div>
      </div>

      {/* Error toast */}
      {errorMsg && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          <span className="flex-1">{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-red-600">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Tour progress bar */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center gap-0">
          {tours.map((t, i) => {
            const isDone = t < activeTour;
            const isActive = t === activeTour;
            return (
              <div key={t} className="flex items-center flex-1">
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                      isDone
                        ? "bg-green-500 text-white shadow-sm"
                        : isActive
                        ? "bg-blue-600 text-white shadow-md ring-4 ring-blue-100"
                        : "bg-gray-200 text-gray-400"
                    }`}
                  >
                    {isDone ? (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M3 8L6.5 11.5L13 4.5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      t
                    )}
                  </div>
                  <span
                    className={`text-sm font-semibold whitespace-nowrap ${
                      isDone ? "text-green-600" : isActive ? "text-blue-700" : "text-gray-400"
                    }`}
                  >
                    Tour {t}
                  </span>
                </div>
                {i < tours.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-3 rounded-full transition-all ${
                      isDone ? "bg-green-400" : "bg-gray-200"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="animate-spin text-blue-500" size={32} />
        </div>
      ) : (
        <>
          {/* ═══════════════════════════════════════════════
              VUE CALENDRIER / EMPLOI DU TEMPS
              ═══════════════════════════════════════════════ */}
          {viewMode === "calendrier" && (
            <div className="space-y-4">
              {slotsLoading ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="animate-spin text-blue-500" size={28} />
                </div>
              ) : !calendarData || allSlots.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
                  <Calendar className="mx-auto text-gray-300 mb-3" size={48} />
                  <p className="text-gray-500 font-medium">Aucun créneau disponible</p>
                  <p className="text-sm text-gray-400 mt-1">
                    Les créneaux apparaîtront ici dès qu&apos;ils seront publiés par l&apos;administration.
                  </p>
                </div>
              ) : (
                <>
                  {/* Legend */}
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Légende des épreuves</p>
                    <div className="flex flex-wrap gap-2">
                      {Array.from(epreuveColorMap.entries()).map(([name, color]) => (
                        <span
                          key={name}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${color.bg} ${color.text} border ${color.border}`}
                        >
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color.accent }} />
                          {name}
                        </span>
                      ))}
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 border border-green-300">
                        <span className="w-2 h-2 rounded-full bg-green-500" />
                        Inscrit
                      </span>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-500 border border-gray-300">
                        <span className="w-2 h-2 rounded-full bg-gray-400" />
                        Complet
                      </span>
                    </div>
                  </div>

                  {/* Calendar grid */}
                  <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <div
                        className="min-w-[700px]"
                        style={{
                          display: "grid",
                          gridTemplateColumns: `80px repeat(${calendarData.dates.length}, minmax(160px, 1fr))`,
                        }}
                      >
                        {/* Header row */}
                        <div className="bg-gray-50 border-b border-r border-gray-200 p-3 sticky left-0 z-10" />
                        {calendarData.dates.map((date) => {
                          const d = new Date(date + "T12:00:00");
                          const dayName = DAYS_FR[d.getDay()];
                          const dayShort = DAYS_SHORT[d.getDay()];
                          return (
                            <div
                              key={date}
                              className="bg-gray-50 border-b border-r border-gray-200 p-3 text-center"
                            >
                              <p className="text-xs font-bold text-gray-700 uppercase">{dayShort}</p>
                              <p className="text-lg font-bold text-gray-900">{d.getDate()}</p>
                              <p className="text-xs text-gray-400">
                                {d.toLocaleDateString("fr-FR", { month: "short" })}
                              </p>
                            </div>
                          );
                        })}

                        {/* Time rows */}
                        {calendarData.timeRows.map((time) => (
                          <>
                            {/* Time label */}
                            <div
                              key={`label-${time}`}
                              className="bg-gray-50 border-b border-r border-gray-200 p-2 flex items-start justify-center sticky left-0 z-10"
                            >
                              <span className="text-xs font-mono font-semibold text-gray-500">{time}</span>
                            </div>

                            {/* Cells for each date */}
                            {calendarData.dates.map((date) => {
                              const slotsInCell = calendarData.slotMap.get(date)?.get(time) || [];
                              return (
                                <div
                                  key={`${date}-${time}`}
                                  className="border-b border-r border-gray-100 p-1.5 min-h-[70px]"
                                >
                                  {slotsInCell.map((slot) => {
                                    const epreuveName = slot.epreuve?.name || "Créneau";
                                    const color = epreuveColorMap.get(epreuveName) || EPREUVE_COLORS[0];
                                    const isSlotEnrolled = enrolledSlotIds.has(slot.id) || slot.isEnrolled;
                                    const epreuveId = epreuves.find((ep) => ep.name === epreuveName)?.id;
                                    const isEpreuveEnrolled = epreuveId ? enrolledEpreuves.has(epreuveId) : false;
                                    const spotsLeft = slot.maxCandidates - slot.enrolledCount;

                                    return (
                                      <button
                                        key={slot.id}
                                        onClick={() => setSelectedSlot(slot)}
                                        className={`w-full text-left rounded-lg p-2 mb-1 border transition-all text-xs cursor-pointer hover:shadow-md ${
                                          isSlotEnrolled
                                            ? "bg-green-50 border-green-300 ring-2 ring-green-200"
                                            : slot.isFull
                                            ? "bg-gray-50 border-gray-200 opacity-50"
                                            : `${color.bg} ${color.border} hover:ring-2 hover:ring-offset-1`
                                        }`}
                                        style={
                                          !isSlotEnrolled && !slot.isFull
                                            ? { borderLeftWidth: "3px", borderLeftColor: color.accent }
                                            : isSlotEnrolled
                                            ? { borderLeftWidth: "3px", borderLeftColor: "#22C55E" }
                                            : {}
                                        }
                                      >
                                        <p className={`font-semibold truncate ${isSlotEnrolled ? "text-green-800" : slot.isFull ? "text-gray-400" : color.text}`}>
                                          {epreuveName}
                                        </p>
                                        <p className={`mt-0.5 ${isSlotEnrolled ? "text-green-600" : "text-gray-500"}`}>
                                          {formatTime(slot.startTime)} - {formatTime(slot.endTime)}
                                        </p>
                                        {slot.room && (
                                          <p className="text-gray-400 flex items-center gap-0.5 mt-0.5">
                                            <MapPin size={10} className="flex-shrink-0" />
                                            {slot.room}
                                          </p>
                                        )}
                                        <div className="mt-1">
                                          {isSlotEnrolled ? (
                                            <span className="text-green-700 font-bold">Inscrit &#10003;</span>
                                          ) : slot.isFull ? (
                                            <span className="text-gray-400 font-medium">Complet</span>
                                          ) : (
                                            <span className={`font-medium ${spotsLeft <= 1 ? "text-orange-600" : "text-gray-500"}`}>
                                              {spotsLeft} place{spotsLeft > 1 ? "s" : ""}
                                            </span>
                                          )}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              );
                            })}
                          </>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════
              VUE ÉPREUVES (CARDS PAR TOUR)
              ═══════════════════════════════════════════════ */}
          {viewMode === "epreuves" && (
            <>
              {epreuves.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
                  <BookOpen className="mx-auto text-gray-300 mb-3" size={48} />
                  <p className="text-gray-500 font-medium">Aucune épreuve publiée pour le moment</p>
                  <p className="text-sm text-gray-400 mt-1">Les épreuves apparaîtront ici dès qu&apos;elles seront configurées par l&apos;administration.</p>
                </div>
              ) : (
                <div className="space-y-8">
                  {epreuvesByTour.map(({ tour, items }) => {
                    if (items.length === 0) return null;
                    const isDone = tour < activeTour;
                    const isActive = tour === activeTour;
                    const isUpcoming = tour > activeTour;
                    return (
                      <div key={tour}>
                        <h1 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                          <span
                            className={`inline-block w-3 h-3 rounded-full ${
                              isDone ? "bg-green-500" : isActive ? "bg-blue-600" : "bg-gray-300"
                            }`}
                          />
                          Tour {tour}
                          {isDone && (
                            <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full ml-1">
                              Terminé
                            </span>
                          )}
                          {isActive && (
                            <span className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full ml-1">
                              En cours
                            </span>
                          )}
                          {isUpcoming && (
                            <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full ml-1">
                              À venir
                            </span>
                          )}
                        </h1>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {items.map((ep) => {
                            const style = TYPE_STYLES[ep.type] || TYPE_STYLES.commune;
                            const isExpanded = expandedId === ep.id;
                            const hasDescription = !!ep.description;
                            const hasDocs = (ep.documentsUrls?.length || 0) > 0;
                            const hasDetails = hasDescription || hasDocs;
                            const isEnrolled = enrolledEpreuves.has(ep.id);

                            const displayDate = ep.date || ep.dateDebut;
                            const displayTime = ep.time;
                            const displayEndDate = ep.dateFin;

                            return (
                              <div
                                key={ep.id}
                                className={`bg-white border rounded-xl overflow-hidden transition-all ${
                                  isActive ? "border-gray-200 hover:border-blue-300 hover:shadow-sm" : "border-gray-100 opacity-80"
                                }`}
                              >
                                <div className="p-4">
                                  <div className="flex items-start justify-between mb-3">
                                    <div className="flex-1 min-w-0">
                                      <h1 className="text-[15px] font-semibold text-gray-900 leading-tight">{ep.name}</h1>
                                      {ep.presentedBy && (
                                        <p className="text-xs text-gray-400 mt-0.5">Présenté par {ep.presentedBy}</p>
                                      )}
                                    </div>
                                    <span
                                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${style.bg} ${style.text} flex-shrink-0 ml-2`}
                                    >
                                      <span>{style.icon}</span>
                                      {style.label}
                                    </span>
                                  </div>

                                  <div className="space-y-2 text-sm text-gray-600">
                                    {displayDate && (
                                      <div className="flex items-center gap-2">
                                        <Calendar size={14} className="text-gray-400 flex-shrink-0" />
                                        <span className="capitalize">{formatDateFr(displayDate)}</span>
                                        {displayTime && (
                                          <span className="text-gray-400 font-mono text-xs">
                                            {formatTime(displayTime)}
                                            {ep.durationMinutes && ` (${ep.durationMinutes}min)`}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                    {displayEndDate && displayEndDate !== displayDate && (
                                      <div className="flex items-center gap-2">
                                        <Clock size={14} className="text-gray-400 flex-shrink-0" />
                                        <span className="text-xs text-gray-500">Jusqu&apos;au {formatDateFr(displayEndDate)}</span>
                                      </div>
                                    )}
                                    {ep.salle && (
                                      <div className="flex items-center gap-2">
                                        <MapPin size={14} className="text-gray-400 flex-shrink-0" />
                                        <span>{ep.salle}</span>
                                      </div>
                                    )}
                                    {ep.durationMinutes && !displayTime && (
                                      <div className="flex items-center gap-2">
                                        <Clock size={14} className="text-gray-400 flex-shrink-0" />
                                        <span>{ep.durationMinutes} minutes</span>
                                      </div>
                                    )}
                                  </div>

                                  {hasDetails && (
                                    <button
                                      onClick={() => toggleExpand(ep.id)}
                                      className="flex items-center gap-1 mt-3 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
                                    >
                                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                      {isExpanded ? "Moins de détails" : "Plus de détails"}
                                    </button>
                                  )}
                                </div>

                                {isExpanded && hasDetails && (
                                  <div className="px-4 pb-4 pt-0 border-t border-gray-100">
                                    {hasDescription && (
                                      <div className="mt-3">
                                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Description</p>
                                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{ep.description}</p>
                                      </div>
                                    )}
                                    {hasDocs && (
                                      <div className="mt-3">
                                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                          Documents ({ep.documentsUrls!.length})
                                        </p>
                                        <div className="space-y-1.5">
                                          {ep.documentsUrls!.map((url, i) => {
                                            const filename = url.split("/").pop() || `Document ${i + 1}`;
                                            return (
                                              <a
                                                key={i}
                                                href={url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg px-2 py-1.5 transition-colors"
                                              >
                                                <FileText size={14} className="flex-shrink-0" />
                                                <span className="truncate">{decodeURIComponent(filename)}</span>
                                              </a>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Registration status */}
                                {ep.type !== "commune" && isActive && (
                                  <div className="px-4 pb-4 pt-1">
                                    {isEnrolled ? (
                                      <div className="w-full py-2.5 text-sm font-semibold text-center text-green-700 bg-green-50 border border-green-200 rounded-lg">
                                        Inscrit(e) &#10003;
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => setViewMode("calendrier")}
                                        className="w-full py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center justify-center gap-2"
                                      >
                                        <Calendar size={15} />
                                        Voir le calendrier pour s&apos;inscrire
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════
          MODALE DÉTAILS DU CRÉNEAU
          ═══════════════════════════════════════════════ */}
      {selectedSlot && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedSlot(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header with color accent */}
            {(() => {
              const epreuveName = selectedSlot.epreuve?.name || "Créneau";
              const color = epreuveColorMap.get(epreuveName) || EPREUVE_COLORS[0];
              const isSlotEnrolled = enrolledSlotIds.has(selectedSlot.id) || selectedSlot.isEnrolled;
              const epreuveId = epreuves.find((ep) => ep.name === epreuveName)?.id;
              const isEpreuveEnrolled = epreuveId ? enrolledEpreuves.has(epreuveId) : false;
              const spotsLeft = selectedSlot.maxCandidates - selectedSlot.enrolledCount;
              const dateFr = selectedSlot.date ? formatDateFr(selectedSlot.date.split("T")[0]) : "Date non définie";

              return (
                <>
                  <div
                    className="h-2"
                    style={{ backgroundColor: isSlotEnrolled ? "#22C55E" : color.accent }}
                  />

                  <div className="px-6 py-5">
                    {/* Close button */}
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h1 className="text-xl font-semibold text-gray-900">{epreuveName}</h1>
                        {selectedSlot.label && (
                          <p className="text-sm text-gray-500 mt-0.5">{selectedSlot.label}</p>
                        )}
                      </div>
                      <button
                        onClick={() => setSelectedSlot(null)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                      >
                        <X size={18} />
                      </button>
                    </div>

                    {/* Details grid */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                        <Calendar size={18} className="text-blue-500 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-400 font-medium">Date</p>
                          <p className="text-sm font-semibold text-gray-900 capitalize">{dateFr}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                        <Clock size={18} className="text-purple-500 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-400 font-medium">Horaire</p>
                          <p className="text-sm font-semibold text-gray-900">
                            {formatTime(selectedSlot.startTime)} - {formatTime(selectedSlot.endTime)}
                          </p>
                        </div>
                      </div>

                      {selectedSlot.room && (
                        <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl border border-blue-100">
                          <MapPin size={18} className="text-blue-600 flex-shrink-0" />
                          <div>
                            <p className="text-xs text-blue-500 font-medium">Salle</p>
                            <p className="text-sm font-bold text-blue-800">{selectedSlot.room}</p>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                        <Users size={18} className="text-gray-500 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-400 font-medium">Places</p>
                          <p className="text-sm font-semibold text-gray-900">
                            {selectedSlot.enrolledCount} / {selectedSlot.maxCandidates}
                            <span className={`ml-2 text-xs font-medium ${spotsLeft <= 1 && spotsLeft > 0 ? "text-orange-600" : spotsLeft === 0 ? "text-red-500" : "text-green-600"}`}>
                              ({spotsLeft > 0 ? `${spotsLeft} place${spotsLeft > 1 ? "s" : ""} restante${spotsLeft > 1 ? "s" : ""}` : "Complet"})
                            </span>
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Action button */}
                    <div className="mt-6">
                      {isSlotEnrolled ? (
                        <div className="w-full py-3 text-sm font-bold text-center text-green-700 bg-green-50 border-2 border-green-200 rounded-xl">
                          Vous êtes inscrit(e) à ce créneau &#10003;
                        </div>
                      ) : isEpreuveEnrolled ? (
                        <div className="w-full py-3 text-sm font-medium text-center text-amber-700 bg-amber-50 border border-amber-200 rounded-xl">
                          Vous êtes déjà inscrit(e) à un autre créneau pour cette épreuve
                        </div>
                      ) : selectedSlot.isFull ? (
                        <div className="w-full py-3 text-sm font-medium text-center text-gray-500 bg-gray-50 border border-gray-200 rounded-xl">
                          Ce créneau est complet
                        </div>
                      ) : (
                        <button
                          onClick={() => handleEnrollInSlot(selectedSlot)}
                          disabled={enrolling === selectedSlot.id}
                          className="w-full py-3 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {enrolling === selectedSlot.id ? (
                            <>
                              <Loader2 className="animate-spin" size={16} />
                              Inscription...
                            </>
                          ) : (
                            <>
                              <Calendar size={16} />
                              S&apos;inscrire à ce créneau
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
