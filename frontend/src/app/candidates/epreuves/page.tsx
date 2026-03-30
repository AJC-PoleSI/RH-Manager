"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";
import { Loader2, Calendar, MapPin, FileText, Clock, ChevronDown, ChevronUp, Users, BookOpen } from "lucide-react";

interface Epreuve {
  id: string;
  name: string;
  type: "commune" | "individuelle" | "groupe";
  tour: number;
  durationMinutes?: number;
  description?: string | null;
  documentsUrls?: string[];
  // Commune fields
  date?: string | null;
  time?: string | null;
  salle?: string | null;
  presentedBy?: string | null;
  // Individuelle/groupe fields
  dateDebut?: string | null;
  dateFin?: string | null;
  // Registration
  registrationOpen?: boolean;
}

const TOUR_LABELS = ["Tour 1", "Tour 2", "Tour 3"];

const TYPE_STYLES: Record<string, { bg: string; text: string; border: string; label: string; icon: string }> = {
  commune: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", label: "Sur table", icon: "📝" },
  individuelle: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", label: "Individuelle", icon: "👤" },
  groupe: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", label: "Groupe", icon: "👥" },
};

function formatDateFr(dateStr?: string | null) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function formatTime(timeStr?: string | null) {
  if (!timeStr) return "";
  return timeStr.slice(0, 5); // "09:00"
}

export default function CandidateEpreuvesPage() {
  const { user } = useAuth();
  const [epreuves, setEpreuves] = useState<Epreuve[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [enrolledSlots, setEnrolledSlots] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await api.get("/epreuves");
        if (res.data && Array.isArray(res.data)) {
          setEpreuves(res.data);
        }
      } catch (err) {
        console.error("Erreur chargement épreuves:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Determine active tour dynamically:
  // The lowest tour number that has épreuves with future dates or no dates set
  const now = new Date();
  const activeTour = (() => {
    const toursWithFutureEpreuves = epreuves
      .filter((e) => {
        const dateStr = e.date || e.dateFin || e.dateDebut;
        if (!dateStr) return true; // No date = not yet scheduled = could be active
        return new Date(dateStr + "T23:59:59") >= now;
      })
      .map((e) => e.tour);
    if (toursWithFutureEpreuves.length === 0) {
      // All past → show last tour
      return Math.max(...epreuves.map((e) => e.tour), 1);
    }
    return Math.min(...toursWithFutureEpreuves);
  })();

  const tours = Array.from(new Set(epreuves.map((e) => e.tour))).sort();
  if (tours.length === 0) tours.push(1, 2, 3);

  const epreuvesByTour = tours.map((t) => ({
    tour: t,
    items: epreuves.filter((e) => e.tour === t),
  }));

  const handleRegister = async (epreuveId: string) => {
    setEnrolling(epreuveId);
    try {
      await api.post("/slots/enroll", { epreuveId });
      setEnrolledSlots((prev) => new Set(prev).add(epreuveId));
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Erreur lors de l'inscription";
      alert(msg);
    } finally {
      setEnrolling(null);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Épreuves & Tours</h1>
        <p className="text-sm text-gray-500 mt-1">
          Votre parcours de recrutement — consultez les épreuves de chaque tour
        </p>
      </div>

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
      ) : epreuves.length === 0 ? (
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
                <h2 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
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
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {items.map((ep) => {
                    const style = TYPE_STYLES[ep.type] || TYPE_STYLES.commune;
                    const isExpanded = expandedId === ep.id;
                    const hasDescription = !!ep.description;
                    const hasDocs = (ep.documentsUrls?.length || 0) > 0;
                    const hasDetails = hasDescription || hasDocs;
                    const isEnrolled = enrolledSlots.has(ep.id);

                    // Determine date/time display
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
                        {/* Card header */}
                        <div className="p-4">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1 min-w-0">
                              <h3 className="text-[15px] font-bold text-gray-900 leading-tight">{ep.name}</h3>
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

                          {/* Info grid */}
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

                          {/* Expand button for description/documents */}
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

                        {/* Expanded content */}
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
                                    const filename = url.split('/').pop() || `Document ${i + 1}`;
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

                        {/* Registration button for individuelle épreuves */}
                        {ep.type === "individuelle" && isActive && (
                          <div className="px-4 pb-4 pt-1">
                            {isEnrolled ? (
                              <div className="w-full py-2.5 text-sm font-semibold text-center text-green-700 bg-green-50 border border-green-200 rounded-lg">
                                Inscrit(e) ✓
                              </div>
                            ) : (
                              <button
                                onClick={() => handleRegister(ep.id)}
                                disabled={enrolling === ep.id}
                                className="w-full py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                              >
                                {enrolling === ep.id ? (
                                  <>
                                    <Loader2 className="animate-spin" size={14} />
                                    Inscription...
                                  </>
                                ) : (
                                  "S\u2019inscrire à un créneau"
                                )}
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
    </div>
  );
}
