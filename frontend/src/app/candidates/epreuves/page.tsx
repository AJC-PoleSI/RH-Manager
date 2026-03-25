"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";

interface Epreuve {
  id: string;
  name: string;
  type: "commune" | "individuelle" | "groupe";
  tour: number;
  dateStart?: string;
  dateEnd?: string;
  room?: string;
  documentsCount?: number;
  registrationOpen?: boolean;
  durationMinutes?: number;
}

const DEMO_EPREUVES: Epreuve[] = [
  { id: "1", name: "Culture générale", type: "commune", tour: 1, dateStart: "2026-04-06 09:00", dateEnd: "2026-04-06 12:00", room: "Amphi A", documentsCount: 2 },
  { id: "2", name: "Anglais écrit", type: "commune", tour: 1, dateStart: "2026-04-08 14:00", dateEnd: "2026-04-08 16:00", room: "Salle 201", documentsCount: 1 },
  { id: "3", name: "Entretien individuel", type: "individuelle", tour: 2, dateStart: "2026-04-15 09:00", dateEnd: "2026-04-15 18:00", room: "Bureau RH", documentsCount: 0, registrationOpen: true },
  { id: "4", name: "Étude de cas", type: "groupe", tour: 2, dateStart: "2026-04-18 10:00", dateEnd: "2026-04-18 12:00", room: "Salle 305", documentsCount: 3 },
  { id: "5", name: "Oral de motivation", type: "individuelle", tour: 3, dateStart: "2026-04-25 09:00", dateEnd: "2026-04-25 17:00", room: "Salle 102", documentsCount: 1, registrationOpen: false },
  { id: "6", name: "Synthèse collective", type: "groupe", tour: 3, dateStart: "2026-04-28 14:00", dateEnd: "2026-04-28 16:00", room: "Amphi B", documentsCount: 2 },
];

const TOUR_LABELS = ["Tour 1", "Tour 2", "Tour 3"];

const TYPE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  commune: { bg: "bg-[#EFF6FF]", text: "text-[#2563EB]", label: "Commune" },
  individuelle: { bg: "bg-[#FFF0F3]", text: "text-[#E8446A]", label: "Individuelle" },
  groupe: { bg: "bg-[#DCFCE7]", text: "text-[#16A34A]", label: "Groupe" },
};

function formatDate(dateStr?: string) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function formatTime(dateStr?: string) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function CandidateEpreuvesPage() {
  const { user } = useAuth();
  const [epreuves, setEpreuves] = useState<Epreuve[]>(DEMO_EPREUVES);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState<string | null>(null);

  useEffect(() => {
    const fetchEpreuves = async () => {
      try {
        const res = await api.get("/epreuves");
        if (res.data && Array.isArray(res.data) && res.data.length > 0) {
          setEpreuves(res.data);
        }
      } catch {
        // Use demo data
      } finally {
        setLoading(false);
      }
    };
    fetchEpreuves();
  }, []);

  // Determine active tour (lowest tour that has at least one epreuve not yet passed)
  const tours = [1, 2, 3];
  const activeTour = 2; // demo: Tour 2 is active

  const epreuvesByTour = tours.map((t) => ({
    tour: t,
    items: epreuves.filter((e) => e.tour === t),
  }));

  const handleRegister = async (epreuveId: string) => {
    setEnrolling(epreuveId);
    try {
      await api.post("/slots/enroll", { epreuveId });
    } catch {
      // silent
    } finally {
      setEnrolling(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Épreuves &amp; Tours</h1>
        <p className="text-sm text-gray-500 mt-1">Votre parcours de recrutement</p>
      </div>

      {/* Tour progress bar */}
      <div className="bg-white border border-gray-200 rounded-[10px] p-[14px_16px]">
        <div className="flex items-center gap-0">
          {tours.map((t, i) => {
            const isDone = t < activeTour;
            const isActive = t === activeTour;
            const isUpcoming = t > activeTour;
            return (
              <div key={t} className="flex items-center flex-1">
                {/* Step circle */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      isDone
                        ? "bg-[#16A34A] text-white"
                        : isActive
                        ? "bg-[#2563EB] text-white"
                        : "bg-gray-200 text-gray-500"
                    }`}
                  >
                    {isDone ? (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M2 7L5.5 10.5L12 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      t
                    )}
                  </div>
                  <span
                    className={`text-sm font-semibold whitespace-nowrap ${
                      isDone
                        ? "text-[#16A34A]"
                        : isActive
                        ? "text-[#2563EB]"
                        : "text-gray-400"
                    }`}
                  >
                    {TOUR_LABELS[i]}
                  </span>
                </div>
                {/* Connector line */}
                {i < tours.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-3 rounded-full ${
                      isDone ? "bg-[#16A34A]" : "bg-gray-200"
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
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        </div>
      ) : (
        /* Epreuves by tour */
        <div className="space-y-6">
          {epreuvesByTour.map(({ tour, items }) => {
            if (items.length === 0) return null;
            const isDone = tour < activeTour;
            const isActive = tour === activeTour;
            return (
              <div key={tour}>
                <h2 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full ${
                      isDone ? "bg-[#16A34A]" : isActive ? "bg-[#2563EB]" : "bg-gray-300"
                    }`}
                  />
                  {TOUR_LABELS[tour - 1]}
                  {isDone && (
                    <span className="text-xs font-medium text-[#16A34A] ml-1">Terminé</span>
                  )}
                  {isActive && (
                    <span className="text-xs font-medium text-[#2563EB] ml-1">En cours</span>
                  )}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {items.map((ep) => {
                    const style = TYPE_STYLES[ep.type] || TYPE_STYLES.commune;
                    return (
                      <div
                        key={ep.id}
                        className="bg-white border border-gray-200 rounded-[10px] p-[14px_16px]"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <h3 className="text-sm font-bold text-gray-900">{ep.name}</h3>
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${style.bg} ${style.text}`}
                          >
                            {style.label}
                          </span>
                        </div>

                        <div className="space-y-1.5 text-sm text-gray-600">
                          {ep.dateStart && (
                            <div className="flex items-center gap-2">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 flex-shrink-0">
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                              </svg>
                              <span>{formatDate(ep.dateStart)}</span>
                              {ep.dateStart && ep.dateEnd && (
                                <span className="text-gray-400">
                                  {formatTime(ep.dateStart)} - {formatTime(ep.dateEnd)}
                                </span>
                              )}
                            </div>
                          )}
                          {ep.room && (
                            <div className="flex items-center gap-2">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 flex-shrink-0">
                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                              </svg>
                              <span>{ep.room}</span>
                            </div>
                          )}
                          {(ep.documentsCount ?? 0) > 0 && (
                            <div className="flex items-center gap-2">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 flex-shrink-0">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                              </svg>
                              <span>{ep.documentsCount} document{(ep.documentsCount ?? 0) > 1 ? "s" : ""} joint{(ep.documentsCount ?? 0) > 1 ? "s" : ""}</span>
                            </div>
                          )}
                        </div>

                        {ep.type === "individuelle" && ep.registrationOpen && (
                          <div className="mt-3 pt-3 border-t border-gray-100">
                            <button
                              onClick={() => handleRegister(ep.id)}
                              disabled={enrolling === ep.id}
                              className="w-full py-2 text-sm font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
                            >
                              {enrolling === ep.id ? "Inscription..." : "S\u2019inscrire"}
                            </button>
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
