"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, LayoutGrid, Table, Layers, ChevronLeft, ChevronRight, X, RotateCcw } from "lucide-react";

interface Wish {
  pole: string;
  rank: number;
}

interface Candidate {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  formation?: string;
  evaluations?: Evaluation[];
  deliberation?: Deliberation;
  wishes?: Wish[];
}

interface Evaluation {
  id: string;
  scores: any;
  comment?: string;
  epreuve?: { name: string; tour: number; type?: string };
  member?: { email: string; firstName?: string; lastName?: string };
}

interface Deliberation {
  tour1Status?: string;
  tour2Status?: string;
  tour3Status?: string;
  prosComment?: string;
  consComment?: string;
  assignedPole?: string;
}

interface ReserveData {
  [candidateId: string]: { pros: string; cons: string };
}

type ViewMode = "tinder" | "table" | "cards";

export default function DeliberationsPage() {
  const { user } = useAuth();
  const isAdmin = user?.isAdmin === true;
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTour, setSelectedTour] = useState(1);
  const [reserveNotes, setReserveNotes] = useState<ReserveData>({});
  const [showReserveModal, setShowReserveModal] = useState(false);
  const [showValidateModal, setShowValidateModal] = useState(false);
  const [validateMessages, setValidateMessages] = useState<{ [id: string]: string }>({});

  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>("tinder");

  // Tinder card state
  const [currentIndex, setCurrentIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<"left" | "right" | "up" | null>(null);

  const tourKey = `tour${selectedTour}Status` as keyof Deliberation;

  // KPI Poles
  const [poleKpis, setPoleKpis] = useState<any>(null);
  const [showPoleKpis, setShowPoleKpis] = useState(false);

  // Cards view: expanded pole
  const [expandedPole, setExpandedPole] = useState<string | null>(null);

  const fetchPoleKpis = useCallback(async () => {
    try {
      const res = await api.get('/kpis/poles');
      setPoleKpis(res.data);
    } catch { setPoleKpis(null); }
  }, []);

  useEffect(() => { fetchPoleKpis(); }, [fetchPoleKpis]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/deliberations");
      setCandidates(Array.isArray(res.data) ? res.data : []);
    } catch {
      try {
        const res = await api.get("/candidates?limit=1000");
        const list = Array.isArray(res.data) ? res.data : res.data.data || [];
        setCandidates(list);
      } catch {
        setCandidates([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Reset index when tour changes
  useEffect(() => {
    setCurrentIndex(0);
    setExpanded(false);
  }, [selectedTour]);

  const getStatus = (c: Candidate) => c.deliberation?.[tourKey] || "";

  const handleDecision = async (candidateId: string, decision: string) => {
    const current = candidates.find((c) => c.id === candidateId);
    const currentStatus = current?.deliberation?.[tourKey];
    const newStatus = currentStatus === decision ? "" : decision;

    // Animation de swipe
    if (viewMode === "tinder") {
      if (newStatus === "accepted") setSwipeDirection("right");
      else if (newStatus === "refused") setSwipeDirection("left");
      else if (newStatus === "waiting") setSwipeDirection("up");
    }

    try {
      const payload: any = { [tourKey]: newStatus || "pending" };
      if (newStatus === "waiting" && reserveNotes[candidateId]) {
        payload.prosComment = reserveNotes[candidateId].pros;
        payload.consComment = reserveNotes[candidateId].cons;
      }

      await api.put(`/deliberations/${candidateId}`, payload);

      setCandidates((prev) =>
        prev.map((c) => {
          if (c.id === candidateId) {
            return {
              ...c,
              deliberation: {
                ...c.deliberation,
                [tourKey]: newStatus || undefined,
                ...(newStatus === "waiting" && reserveNotes[candidateId]
                  ? { prosComment: reserveNotes[candidateId].pros, consComment: reserveNotes[candidateId].cons }
                  : {}),
              },
            };
          }
          return c;
        })
      );

      // Avancer automatiquement après une décision (Tinder mode)
      if (viewMode === "tinder" && newStatus) {
        setTimeout(() => {
          setSwipeDirection(null);
          setExpanded(false);
          if (currentIndex < filteredCandidates.length - 1) {
            setCurrentIndex((prev) => prev + 1);
          }
        }, 400);
      } else {
        setTimeout(() => setSwipeDirection(null), 300);
      }
    } catch (e) {
      setSwipeDirection(null);
      console.error("Failed to update deliberation:", e);
    }
  };

  const cancelDecision = async (candidateId: string) => {
    try {
      await api.put(`/deliberations/${candidateId}`, { [tourKey]: "pending" });
      setCandidates((prev) =>
        prev.map((c) => {
          if (c.id === candidateId) {
            return { ...c, deliberation: { ...c.deliberation, [tourKey]: undefined } };
          }
          return c;
        })
      );
      setReserveNotes((prev) => {
        const copy = { ...prev };
        delete copy[candidateId];
        return copy;
      });
    } catch (e) {
      console.error("Failed to cancel decision:", e);
    }
  };

  const updateReserveNote = (candidateId: string, field: "pros" | "cons", value: string) => {
    setReserveNotes((prev) => ({
      ...prev,
      [candidateId]: { pros: prev[candidateId]?.pros || "", cons: prev[candidateId]?.cons || "", [field]: value },
    }));
  };

  const saveReserveNotes = async (candidateId: string) => {
    const notes = reserveNotes[candidateId];
    if (!notes) return;
    try {
      await api.put(`/deliberations/${candidateId}`, { prosComment: notes.pros, consComment: notes.cons });
    } catch (e) {
      console.error("Failed to save reserve notes:", e);
    }
  };

  const getAvgScore = (c: Candidate): number => {
    if (!c.evaluations || c.evaluations.length === 0) return 0;
    let total = 0;
    let count = 0;
    c.evaluations.forEach((ev) => {
      try {
        const scores = typeof ev.scores === "string" ? JSON.parse(ev.scores) : ev.scores;
        if (scores) {
          Object.values(scores).forEach((v: any) => {
            total += Number(v) || 0;
            count++;
          });
        }
      } catch {}
    });
    return count > 0 ? Math.round((total / count) * 10) / 10 : 0;
  };

  const getScoreTotal = (scores: any): number => {
    try {
      const parsed = typeof scores === "string" ? JSON.parse(scores) : scores;
      return Object.values(parsed || {}).reduce((sum: number, v: any) => sum + (Number(v) || 0), 0);
    } catch {
      return 0;
    }
  };

  const getEvalCount = (c: Candidate): number => c.evaluations?.length || 0;

  const getInitials = (c: Candidate) =>
    `${(c.firstName || "")[0] || ""}${(c.lastName || "")[0] || ""}`.toUpperCase();

  const getFirstPole = (c: Candidate): string => {
    if (c.wishes && c.wishes.length > 0) {
      const first = c.wishes.find(w => w.rank === 1);
      return first?.pole || c.wishes[0]?.pole || "Non renseigne";
    }
    return "Non renseigne";
  };

  // Filter candidates based on selected tour
  const filteredCandidates = candidates.filter((c) => {
    if (selectedTour === 1) return true;
    if (selectedTour === 2) {
      const t1 = c.deliberation?.tour1Status;
      return t1 === "accepted" || t1 === "waiting";
    }
    if (selectedTour === 3) {
      const t1 = c.deliberation?.tour1Status;
      const t2 = c.deliberation?.tour2Status;
      return t1 === "accepted" && (t2 === "accepted" || t2 === "waiting");
    }
    return true;
  });

  // Group candidates by pole (first wish)
  const candidatesByPole = useMemo(() => {
    const groups: Record<string, Candidate[]> = {};
    filteredCandidates.forEach(c => {
      const pole = getFirstPole(c);
      if (!groups[pole]) groups[pole] = [];
      groups[pole].push(c);
    });
    // Sort poles alphabetically, "Non renseigne" at the end
    const sorted = Object.entries(groups).sort(([a], [b]) => {
      if (a === "Non renseigne") return 1;
      if (b === "Non renseigne") return -1;
      return a.localeCompare(b);
    });
    return sorted;
  }, [filteredCandidates]);

  // Stats
  const reserveCandidates = filteredCandidates.filter((c) => getStatus(c) === "waiting");
  const acceptedCount = filteredCandidates.filter((c) => getStatus(c) === "accepted").length;
  const refusedCount = filteredCandidates.filter((c) => getStatus(c) === "refused").length;
  const pendingCount = filteredCandidates.filter((c) => !getStatus(c) || getStatus(c) === "pending").length;

  // Current candidate (Tinder)
  const currentCandidate = filteredCandidates[currentIndex] || null;

  const handleValidateAndSend = async () => {
    try {
      await api.post("/deliberations/validate", { tour: selectedTour, messages: validateMessages });
      setShowValidateModal(false);
      setValidateMessages({});
      loadData();
    } catch (e) {
      console.error("Failed to validate:", e);
    }
  };

  const goNext = () => {
    if (currentIndex < filteredCandidates.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setExpanded(false);
    }
  };

  const goPrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
      setExpanded(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-blue-500" size={32} />
      </div>
    );
  }

  // Swipe animation
  const getSwipeStyle = (): React.CSSProperties => {
    if (!swipeDirection) return {};
    if (swipeDirection === "right") return { transform: "translateX(120%) rotate(12deg)", opacity: 0, transition: "all 0.4s ease-out" };
    if (swipeDirection === "left") return { transform: "translateX(-120%) rotate(-12deg)", opacity: 0, transition: "all 0.4s ease-out" };
    if (swipeDirection === "up") return { transform: "translateY(-80%) scale(0.9)", opacity: 0, transition: "all 0.4s ease-out" };
    return {};
  };

  const statusBadge = (status: string) => {
    if (status === "accepted") return <span className="px-2 py-0.5 rounded-full text-xs font-semibold text-white bg-green-600">Admis</span>;
    if (status === "refused") return <span className="px-2 py-0.5 rounded-full text-xs font-semibold text-white bg-red-500">Refus</span>;
    if (status === "waiting") return <span className="px-2 py-0.5 rounded-full text-xs font-semibold text-white bg-yellow-600">Reserve</span>;
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium text-gray-500 bg-gray-100">En attente</span>;
  };

  const poleColor = (pole: string): string => {
    const colors: Record<string, string> = {
      "Système d'information": "#3B82F6",
      "Marketing": "#EC4899",
      "Développement commercial": "#F59E0B",
      "Audit Qualité": "#10B981",
      "Ressource Humaine": "#8B5CF6",
      "Trésorerie": "#06B6D4",
      "Bureau - VP": "#6366F1",
      "Bureau - Président": "#EF4444",
      "Bureau - Trésorier": "#14B8A6",
      "Bureau - Secrétaire générale": "#F97316",
    };
    return colors[pole] || "#6B7280";
  };

  // ═══════════════════════════════════════════════
  // ACTION BUTTONS (réutilisable)
  // ═══════════════════════════════════════════════
  const ActionButtons = ({ c, size = "md" }: { c: Candidate; size?: "sm" | "md" }) => {
    const status = getStatus(c);
    const btnSize = size === "sm" ? "w-8 h-8" : "w-12 h-12";
    const iconSize = size === "sm" ? 14 : 20;
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => handleDecision(c.id, "refused")}
          className={`${btnSize} rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95`}
          style={{
            backgroundColor: status === "refused" ? "#E8446A" : "#FFF",
            border: `2px solid ${status === "refused" ? "#E8446A" : "#FCA5A5"}`,
          }}
          title="Refuser"
        >
          <X size={iconSize} color={status === "refused" ? "#FFF" : "#E8446A"} strokeWidth={2.5} />
        </button>
        <button
          onClick={() => handleDecision(c.id, "waiting")}
          className={`${btnSize} rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95`}
          style={{
            backgroundColor: status === "waiting" ? "#CA8A04" : "#FFF",
            border: `2px solid ${status === "waiting" ? "#CA8A04" : "#FDE68A"}`,
          }}
          title="Reserve"
        >
          <span className={`${size === "sm" ? "text-xs" : "text-sm"}`} style={{ filter: status === "waiting" ? "brightness(10)" : "none" }}>&#9203;</span>
        </button>
        {status && status !== "pending" && (
          <button
            onClick={() => cancelDecision(c.id)}
            className={`${size === "sm" ? "w-7 h-7" : "w-9 h-9"} rounded-full flex items-center justify-center transition-all hover:scale-110 bg-white border-2 border-gray-300`}
            title="Annuler"
          >
            <RotateCcw size={size === "sm" ? 10 : 14} color="#9CA3AF" />
          </button>
        )}
        <button
          onClick={() => handleDecision(c.id, "accepted")}
          className={`${btnSize} rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95`}
          style={{
            backgroundColor: status === "accepted" ? "#16A34A" : "#FFF",
            border: `2px solid ${status === "accepted" ? "#16A34A" : "#86EFAC"}`,
          }}
          title="Accepter"
        >
          <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
            <path d="M5 13L9 17L19 7" stroke={status === "accepted" ? "#FFF" : "#16A34A"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Soirée Délibération</h1>
          <p className="text-sm text-gray-500 mt-1">Délibération de fin de tour</p>
        </div>
        {/* View toggle */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode("tinder")}
            className={`p-2 rounded-md transition-colors ${viewMode === "tinder" ? "bg-white shadow-sm text-blue-600" : "text-gray-500 hover:text-gray-700"}`}
            title="Vue Tinder"
          >
            <Layers size={18} />
          </button>
          <button
            onClick={() => setViewMode("table")}
            className={`p-2 rounded-md transition-colors ${viewMode === "table" ? "bg-white shadow-sm text-blue-600" : "text-gray-500 hover:text-gray-700"}`}
            title="Vue Tableau"
          >
            <Table size={18} />
          </button>
          <button
            onClick={() => setViewMode("cards")}
            className={`p-2 rounded-md transition-colors ${viewMode === "cards" ? "bg-white shadow-sm text-blue-600" : "text-gray-500 hover:text-gray-700"}`}
            title="Vue Cartes"
          >
            <LayoutGrid size={18} />
          </button>
        </div>
      </div>

      {/* Tour Selector */}
      <div className="flex items-center gap-3">
        {[1, 2, 3].map((t) => (
          <button
            key={t}
            onClick={() => setSelectedTour(t)}
            className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              selectedTour === t
                ? "bg-white border-2 text-blue-600 shadow-sm"
                : "bg-white border border-gray-200 text-gray-500 hover:border-gray-300"
            }`}
            style={selectedTour === t ? { borderColor: "#2563EB" } : undefined}
          >
            Tour {t}
          </button>
        ))}
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-gray-700">{filteredCandidates.length}</p>
          <p className="text-xs text-gray-400 mt-0.5">Total</p>
        </div>
        <div className="bg-white rounded-xl border border-green-200 p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{acceptedCount}</p>
          <p className="text-xs text-green-500 mt-0.5">Admis</p>
        </div>
        <div className="bg-white rounded-xl border border-yellow-200 p-4 text-center">
          <p className="text-2xl font-bold text-yellow-600">{reserveCandidates.length}</p>
          <p className="text-xs text-yellow-500 mt-0.5">Reserve</p>
        </div>
        <div className="bg-white rounded-xl border border-red-200 p-4 text-center">
          <p className="text-2xl font-bold text-red-500">{refusedCount}</p>
          <p className="text-xs text-red-400 mt-0.5">Refuses</p>
        </div>
      </div>

      {/* KPI VOEUX DE POLES */}
      {poleKpis && poleKpis.poles?.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <button
            onClick={() => setShowPoleKpis(!showPoleKpis)}
            className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-base">&#127919;</span>
              <span className="text-sm font-semibold text-gray-800">Voeux de poles</span>
              <span className="text-xs text-gray-400 ml-1">
                {poleKpis.totalCandidatesWithWishes} candidat(s) &bull; {poleKpis.totalWishes} voeu(x)
              </span>
            </div>
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${showPoleKpis ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showPoleKpis && (
            <div className="px-5 pb-5 border-t border-gray-100">
              <div className="overflow-x-auto mt-3">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Pole</th>
                      <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase text-center">1er choix</th>
                      <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase text-center">2e choix</th>
                      <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase text-center">3e choix</th>
                      <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase text-center">Total</th>
                      <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase text-center">Acceptes</th>
                      <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase text-center">Ratio</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {poleKpis.poles.map((p: any) => {
                      const ratio = p.totalDemandes > 0 ? Math.round((p.placesAcceptees / p.totalDemandes) * 100) : 0;
                      return (
                        <tr key={p.pole} className="hover:bg-gray-50">
                          <td className="px-3 py-2.5 font-medium text-gray-800">{p.pole}</td>
                          <td className="px-3 py-2.5 text-center">
                            <span className="inline-block min-w-[24px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-semibold">{p.demandesRang1}</span>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className="inline-block min-w-[24px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-xs font-medium">{p.demandesRang2}</span>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className="inline-block min-w-[24px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-xs font-medium">{p.demandesRang3}</span>
                          </td>
                          <td className="px-3 py-2.5 text-center font-semibold text-gray-700">{p.totalDemandes}</td>
                          <td className="px-3 py-2.5 text-center">
                            <span className="inline-block min-w-[24px] px-1.5 py-0.5 rounded bg-green-50 text-green-700 text-xs font-semibold">{p.placesAcceptees}</span>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${ratio}%` }} />
                              </div>
                              <span className="text-xs text-gray-500">{ratio}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* VUE TABLEAU PAR POLE */}
      {/* ═══════════════════════════════════════════════ */}
      {viewMode === "table" && (
        <div className="space-y-4">
          {candidatesByPole.length === 0 ? (
            <div className="bg-white rounded-xl border p-12 text-center text-gray-400">
              Aucun candidat pour ce tour.
            </div>
          ) : (
            candidatesByPole.map(([pole, poleCandidates]) => (
              <div key={pole} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Pole header */}
                <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: poleColor(pole) }} />
                  <h3 className="font-semibold text-gray-900">{pole}</h3>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{poleCandidates.length} candidat{poleCandidates.length > 1 ? "s" : ""}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                      <tr>
                        <th className="px-5 py-2.5">Candidat</th>
                        <th className="px-5 py-2.5">Formation</th>
                        <th className="px-5 py-2.5 text-center">Choix pole</th>
                        <th className="px-5 py-2.5 text-center">Evals</th>
                        <th className="px-5 py-2.5 text-center">Moy.</th>
                        <th className="px-5 py-2.5 text-center">Statut</th>
                        <th className="px-5 py-2.5 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {poleCandidates.map(c => {
                        const status = getStatus(c);
                        const avg = getAvgScore(c);
                        const evalC = getEvalCount(c);
                        return (
                          <tr key={c.id} className="hover:bg-gray-50">
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                  {getInitials(c)}
                                </div>
                                <div>
                                  <a href={`/dashboard/candidates/${c.id}`} className="font-medium text-gray-900 hover:text-blue-600">
                                    {c.firstName} {c.lastName}
                                  </a>
                                  <p className="text-xs text-gray-400">{c.email}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-5 py-3 text-gray-600 text-xs">{c.formation || "-"}</td>
                            <td className="px-5 py-3 text-center">
                              <div className="flex flex-col items-center gap-0.5">
                                {c.wishes && c.wishes.length > 0 ? (
                                  c.wishes.slice(0, 3).map((w, i) => (
                                    <span key={`wish-${w.pole}-${w.rank}`} className={`text-[10px] px-1.5 py-0.5 rounded ${w.rank === 1 ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-500'}`}>
                                      {w.rank}. {w.pole}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-gray-400 text-xs">-</span>
                                )}
                              </div>
                            </td>
                            <td className="px-5 py-3 text-center text-gray-600">{evalC}</td>
                            <td className="px-5 py-3 text-center font-bold text-blue-600">{avg || "-"}</td>
                            <td className="px-5 py-3 text-center">{statusBadge(status)}</td>
                            <td className="px-5 py-3">
                              <div className="flex justify-center">
                                <ActionButtons c={c} size="sm" />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* VUE CARTES PAR POLE */}
      {/* ═══════════════════════════════════════════════ */}
      {viewMode === "cards" && (
        <div className="space-y-6">
          {candidatesByPole.length === 0 ? (
            <div className="bg-white rounded-xl border p-12 text-center text-gray-400">
              Aucun candidat pour ce tour.
            </div>
          ) : (
            candidatesByPole.map(([pole, poleCandidates]) => (
              <div key={pole}>
                {/* Pole section header */}
                <button
                  onClick={() => setExpandedPole(expandedPole === pole ? null : pole)}
                  className="w-full flex items-center gap-3 mb-3 group"
                >
                  <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: poleColor(pole) }} />
                  <h1 className="font-semibold text-lg text-gray-900">{pole}</h3>
                  <span className="text-sm text-gray-400">{poleCandidates.length}</span>
                  <div className="flex-1 h-px bg-gray-200" />
                  <svg
                    className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${expandedPole === pole || expandedPole === null ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {(expandedPole === pole || expandedPole === null) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {poleCandidates.map(c => {
                      const status = getStatus(c);
                      const avg = getAvgScore(c);
                      const evalC = getEvalCount(c);
                      return (
                        <div
                          key={c.id}
                          className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
                        >
                          {/* Card header with gradient */}
                          <div
                            className="px-4 pt-4 pb-3"
                            style={{
                              background: status === "accepted"
                                ? "linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%)"
                                : status === "refused"
                                  ? "linear-gradient(135deg, #FFF5F7 0%, #FFE4E9 100%)"
                                  : status === "waiting"
                                    ? "linear-gradient(135deg, #FEFCE8 0%, #FEF9C3 100%)"
                                    : "linear-gradient(135deg, #F8FAFC 0%, #EFF6FF 100%)",
                            }}
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-sm flex-shrink-0"
                                style={{ backgroundColor: poleColor(pole) }}
                              >
                                {getInitials(c)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <a href={`/dashboard/candidates/${c.id}`} className="font-bold text-gray-900 hover:text-blue-600 block truncate">
                                  {c.firstName} {c.lastName}
                                </a>
                                <p className="text-xs text-gray-500 truncate">{c.formation || "Formation non renseignee"}</p>
                              </div>
                              {statusBadge(status)}
                            </div>
                          </div>

                          {/* Card body */}
                          <div className="px-4 py-3 space-y-2">
                            {/* Score */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span>&#11088;</span>
                                <span className="font-bold text-gray-800">{avg || "-"}</span>
                                <span className="text-xs text-gray-400">({evalC} eval{evalC !== 1 ? "s" : ""})</span>
                              </div>
                            </div>

                            {/* Wishes */}
                            {c.wishes && c.wishes.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {c.wishes.slice(0, 3).map((w, i) => (
                                  <span
                                    key={`wish-${w.pole}-${w.rank}`}
                                    className={`text-[10px] px-1.5 py-0.5 rounded ${w.rank === 1 ? 'bg-blue-50 text-blue-700 font-semibold' : 'bg-gray-50 text-gray-500'}`}
                                  >
                                    {w.rank}. {w.pole}
                                  </span>
                                ))}
                              </div>
                            )}

                            {/* Last eval comment */}
                            {c.evaluations && c.evaluations.length > 0 && c.evaluations[0].comment && (
                              <p className="text-xs text-gray-500 italic line-clamp-2">
                                &quot;{c.evaluations[0].comment}&quot;
                              </p>
                            )}
                          </div>

                          {/* Card footer: actions */}
                          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-center">
                            <ActionButtons c={c} size="sm" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* VUE TINDER (existante) */}
      {/* ═══════════════════════════════════════════════ */}
      {viewMode === "tinder" && (
        <>
          {filteredCandidates.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
              <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">&#128101;</span>
              </div>
              <p className="text-gray-400">Aucun candidat pour ce tour.</p>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              {/* Progress indicator */}
              <div className="flex items-center gap-3 mb-4">
                <span className="text-sm text-gray-400">
                  {currentIndex + 1} / {filteredCandidates.length}
                </span>
                <div className="w-48 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-300"
                    style={{ width: `${((currentIndex + 1) / filteredCandidates.length) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-gray-400">{pendingCount} restant{pendingCount > 1 ? "s" : ""}</span>
              </div>

              {/* Card stack */}
              <div className="relative w-full max-w-lg">
                {/* Shadow cards */}
                {currentIndex < filteredCandidates.length - 1 && (
                  <div
                    className="absolute inset-0 bg-white rounded-2xl border border-gray-200 shadow-sm"
                    style={{ transform: "scale(0.95) translateY(12px)", opacity: 0.6, zIndex: 0 }}
                  />
                )}
                {currentIndex < filteredCandidates.length - 2 && (
                  <div
                    className="absolute inset-0 bg-white rounded-2xl border border-gray-100"
                    style={{ transform: "scale(0.90) translateY(24px)", opacity: 0.3, zIndex: -1 }}
                  />
                )}

                {/* MAIN CARD */}
                {currentCandidate && (() => {
                  const c = currentCandidate;
                  const status = getStatus(c);
                  const isReserve = status === "waiting";
                  const avgScore = getAvgScore(c);
                  const evalCount = getEvalCount(c);

                  return (
                    <div
                      className="relative bg-white rounded-2xl border border-gray-200 shadow-lg overflow-hidden cursor-pointer"
                      style={{ ...getSwipeStyle(), zIndex: 1 }}
                      onClick={() => setExpanded(!expanded)}
                    >
                      {/* Status ribbon */}
                      {status === "accepted" && (
                        <div className="absolute top-4 right-4 z-10 px-3 py-1 rounded-full text-xs font-bold text-white bg-green-600">Admis</div>
                      )}
                      {status === "refused" && (
                        <div className="absolute top-4 right-4 z-10 px-3 py-1 rounded-full text-xs font-bold text-white" style={{ backgroundColor: "#E8446A" }}>Refuse</div>
                      )}
                      {status === "waiting" && (
                        <div className="absolute top-4 right-4 z-10 px-3 py-1 rounded-full text-xs font-bold text-white bg-yellow-600">Reserve</div>
                      )}

                      {/* Card header - gradient */}
                      <div
                        className="px-6 pt-8 pb-6"
                        style={{
                          background: status === "accepted"
                            ? "linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%)"
                            : status === "refused"
                              ? "linear-gradient(135deg, #FFF5F7 0%, #FFE4E9 100%)"
                              : status === "waiting"
                                ? "linear-gradient(135deg, #FEFCE8 0%, #FEF9C3 100%)"
                                : "linear-gradient(135deg, #F8FAFC 0%, #EFF6FF 100%)",
                        }}
                      >
                        <div className="flex items-center gap-5">
                          <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-white text-2xl font-bold shadow-md flex-shrink-0 bg-blue-600">
                            {getInitials(c)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h1 className="text-xl font-semibold text-gray-900">{c.firstName} {c.lastName}</h2>
                            <p className="text-sm text-gray-500 mt-0.5">{c.formation || "Formation non renseignee"}</p>
                            {/* Pole wishes */}
                            {c.wishes && c.wishes.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {c.wishes.slice(0, 3).map((w, i) => (
                                  <span key={`wish-${w.pole}-${w.rank}`} className={`text-[10px] px-1.5 py-0.5 rounded ${w.rank === 1 ? 'bg-blue-100 text-blue-700 font-semibold' : 'bg-gray-100 text-gray-500'}`}>
                                    {w.rank}. {w.pole}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center gap-4 mt-2">
                              <div className="flex items-center gap-1.5">
                                <span className="text-lg">&#11088;</span>
                                <span className="text-lg font-bold text-gray-800">{avgScore}</span>
                              </div>
                              <span className="text-xs text-gray-400">
                                {evalCount} evaluation{evalCount !== 1 ? "s" : ""}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Key comments preview */}
                      <div className="px-6 py-4">
                        {c.evaluations && c.evaluations.length > 0 ? (
                          <div className="space-y-2">
                            {c.evaluations.slice(0, 2).map((ev, idx) => (
                              <div key={ev.id || idx} className="flex items-start gap-2">
                                <span className="text-xs text-gray-300 mt-0.5">&#128172;</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-gray-600 line-clamp-2">
                                    {ev.comment || "Pas de commentaire"}
                                  </p>
                                  <p className="text-xs text-gray-400 mt-0.5">
                                    {ev.member?.firstName || ev.member?.email || "Evaluateur"} &middot; {ev.epreuve?.name || ""} &middot; Note: {getScoreTotal(ev.scores)}
                                  </p>
                                </div>
                              </div>
                            ))}
                            {c.evaluations.length > 2 && (
                              <p className="text-xs text-blue-500 font-medium">
                                + {c.evaluations.length - 2} autre{c.evaluations.length - 2 > 1 ? "s" : ""} evaluation{c.evaluations.length - 2 > 1 ? "s" : ""}
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-400 italic">Aucune evaluation disponible</p>
                        )}
                      </div>

                      {/* Reserve notes */}
                      {(c.deliberation?.prosComment || c.deliberation?.consComment) && (
                        <div className="mx-6 mb-3 grid grid-cols-2 gap-2">
                          {c.deliberation.prosComment && (
                            <div className="rounded-lg p-2 text-xs bg-green-50">
                              <span className="font-semibold text-green-600">+ </span>
                              <span className="text-gray-600">{c.deliberation.prosComment}</span>
                            </div>
                          )}
                          {c.deliberation.consComment && (
                            <div className="rounded-lg p-2 text-xs bg-red-50">
                              <span className="font-semibold text-red-500">- </span>
                              <span className="text-gray-600">{c.deliberation.consComment}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* EXPANDED DETAILS */}
                      {expanded && (
                        <div className="border-t border-gray-100 px-6 py-5 space-y-4 bg-gray-50/50" onClick={(e) => e.stopPropagation()}>
                          {/* Contact info */}
                          <div>
                            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Informations</h3>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div className="flex items-center gap-2">
                                <span className="text-gray-400">&#128231;</span>
                                <span className="text-gray-700">{c.email || "-"}</span>
                              </div>
                              {c.phone && (
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-400">&#128241;</span>
                                  <span className="text-gray-700">{c.phone}</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* All evaluations */}
                          {c.evaluations && c.evaluations.length > 0 && (
                            <div>
                              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                                Toutes les evaluations ({c.evaluations.length})
                              </h3>
                              <div className="space-y-2">
                                {c.evaluations.map((ev, idx) => {
                                  const scores = typeof ev.scores === "string" ? JSON.parse(ev.scores) : ev.scores;
                                  return (
                                    <div key={ev.id || idx} className="bg-white rounded-lg border border-gray-200 p-3">
                                      <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center gap-2">
                                          <span className="text-sm font-medium text-gray-800">{ev.epreuve?.name || "Epreuve"}</span>
                                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">Tour {ev.epreuve?.tour}</span>
                                        </div>
                                        <span className="text-lg font-bold text-blue-600">{getScoreTotal(ev.scores)}</span>
                                      </div>
                                      <p className="text-xs text-gray-400 mb-1">
                                        Par {ev.member?.firstName || ev.member?.email || "Evaluateur"}
                                      </p>
                                      {scores && Object.keys(scores).length > 0 && (
                                        <div className="flex gap-1.5 flex-wrap mb-1">
                                          {Object.entries(scores).map(([k, v]) => (
                                            <span key={k} className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-medium">
                                              C{parseInt(k) + 1}: {String(v)}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                      {ev.comment && <p className="text-sm text-gray-600 mt-1">{ev.comment}</p>}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Reserve notes editing */}
                          {isReserve && (
                            <div>
                              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Notes de reserve</h3>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-sm font-semibold mb-1 text-green-600">Points +</label>
                                  <textarea
                                    rows={3}
                                    className="w-full border border-green-400 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                                    placeholder="Points positifs..."
                                    value={reserveNotes[c.id]?.pros || c.deliberation?.prosComment || ""}
                                    onChange={(e) => updateReserveNote(c.id, "pros", e.target.value)}
                                    onBlur={() => saveReserveNotes(c.id)}
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-semibold mb-1 text-red-500">Points -</label>
                                  <textarea
                                    rows={3}
                                    className="w-full border border-red-400 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                                    placeholder="Points negatifs..."
                                    value={reserveNotes[c.id]?.cons || c.deliberation?.consComment || ""}
                                    onChange={(e) => updateReserveNote(c.id, "cons", e.target.value)}
                                    onBlur={() => saveReserveNotes(c.id)}
                                  />
                                </div>
                              </div>
                            </div>
                          )}

                          <a
                            href={`/dashboard/candidates/${c.id}`}
                            className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
                          >
                            Voir la fiche complete &#8594;
                          </a>
                        </div>
                      )}

                      {/* Expand hint */}
                      <div className="text-center py-2 text-xs text-gray-400">
                        {expanded ? "Cliquer pour reduire" : "Cliquer pour voir les details"}
                      </div>

                      {/* ACTION BUTTONS (Tinder-style) */}
                      <div className="px-6 pb-6 pt-2 flex items-center justify-center gap-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleDecision(c.id, "refused")}
                          className="w-14 h-14 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95"
                          style={{
                            backgroundColor: status === "refused" ? "#E8446A" : "#FFF",
                            border: `2.5px solid ${status === "refused" ? "#E8446A" : "#FCA5A5"}`,
                            boxShadow: status === "refused" ? "0 4px 12px rgba(232,68,106,0.3)" : "0 2px 8px rgba(0,0,0,0.06)",
                          }}
                        >
                          <X size={24} color={status === "refused" ? "#FFF" : "#E8446A"} strokeWidth={2.5} />
                        </button>

                        <button
                          onClick={() => handleDecision(c.id, "waiting")}
                          className="w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95"
                          style={{
                            backgroundColor: status === "waiting" ? "#CA8A04" : "#FFF",
                            border: `2.5px solid ${status === "waiting" ? "#CA8A04" : "#FDE68A"}`,
                            boxShadow: status === "waiting" ? "0 4px 12px rgba(202,138,4,0.3)" : "0 2px 8px rgba(0,0,0,0.06)",
                          }}
                        >
                          <span className="text-lg" style={{ filter: status === "waiting" ? "brightness(10)" : "none" }}>&#9203;</span>
                        </button>

                        {status && status !== "pending" && (
                          <button
                            onClick={() => cancelDecision(c.id)}
                            className="w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95 bg-white border-2 border-gray-300"
                            style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}
                          >
                            <RotateCcw size={16} color="#9CA3AF" />
                          </button>
                        )}

                        <button
                          onClick={() => handleDecision(c.id, "accepted")}
                          className="w-14 h-14 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95"
                          style={{
                            backgroundColor: status === "accepted" ? "#16A34A" : "#FFF",
                            border: `2.5px solid ${status === "accepted" ? "#16A34A" : "#86EFAC"}`,
                            boxShadow: status === "accepted" ? "0 4px 12px rgba(22,163,74,0.3)" : "0 2px 8px rgba(0,0,0,0.06)",
                          }}
                        >
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                            <path d="M5 13L9 17L19 7" stroke={status === "accepted" ? "#FFF" : "#16A34A"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Navigation */}
              <div className="flex items-center gap-4 mt-6">
                <button
                  onClick={goPrev}
                  disabled={currentIndex === 0}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={16} /> Precedent
                </button>
                <button
                  onClick={goNext}
                  disabled={currentIndex >= filteredCandidates.length - 1}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Suivant <ChevronRight size={16} />
                </button>
              </div>

              {/* Mini thumbnails */}
              <div className="flex items-center gap-1.5 mt-4 flex-wrap justify-center max-w-lg">
                {filteredCandidates.map((c, idx) => {
                  const st = getStatus(c);
                  const bg = st === "accepted" ? "#16A34A" : st === "refused" ? "#E8446A" : st === "waiting" ? "#CA8A04" : "#D1D5DB";
                  return (
                    <button
                      key={c.id}
                      onClick={() => { setCurrentIndex(idx); setExpanded(false); }}
                      className="relative transition-all"
                      title={`${c.firstName} ${c.lastName}`}
                      style={{
                        width: idx === currentIndex ? 28 : 10,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: bg,
                        opacity: idx === currentIndex ? 1 : 0.5,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Bottom Action Buttons */}
      <div className="flex items-center justify-end gap-3">
        <button
          onClick={() => setShowReserveModal(true)}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all"
        >
          Voir les reserves
        </button>
        <button
          onClick={() => setShowValidateModal(true)}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-all"
        >
          Valider et Envoyer
        </button>
      </div>

      {/* Reserve Modal */}
      {showReserveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto mx-4">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h1 className="text-lg font-semibold text-gray-900">Candidats en reserve ({reserveCandidates.length})</h3>
              <button onClick={() => setShowReserveModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {reserveCandidates.length === 0 && (
                <p className="text-center text-gray-400 py-8">Aucun candidat en reserve pour ce tour.</p>
              )}
              {reserveCandidates.map((c) => (
                <div key={c.id} className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-xs bg-blue-600">
                      {getInitials(c)}
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">{c.firstName} {c.lastName}</div>
                      <div className="text-xs text-gray-500">{c.formation || ""}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-lg p-3 text-sm bg-green-50">
                      <div className="font-semibold text-xs mb-1 text-green-600">Points +</div>
                      <p className="text-gray-700">{reserveNotes[c.id]?.pros || c.deliberation?.prosComment || "Aucun commentaire"}</p>
                    </div>
                    <div className="rounded-lg p-3 text-sm bg-red-50">
                      <div className="font-semibold text-xs mb-1 text-red-500">Points -</div>
                      <p className="text-gray-700">{reserveNotes[c.id]?.cons || c.deliberation?.consComment || "Aucun commentaire"}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Validate & Send Modal */}
      {showValidateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto mx-4">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h1 className="text-lg font-semibold text-gray-900">Valider et Envoyer</h3>
              <button onClick={() => setShowValidateModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl p-4 text-center bg-green-50">
                  <div className="text-3xl font-bold text-green-600">{acceptedCount}</div>
                  <div className="text-sm text-gray-600 mt-1">Admis</div>
                </div>
                <div className="rounded-xl p-4 text-center bg-red-50">
                  <div className="text-3xl font-bold text-red-500">{refusedCount}</div>
                  <div className="text-sm text-gray-600 mt-1">Refuses</div>
                </div>
              </div>

              {/* Per-candidate messages */}
              <div className="space-y-4">
                <h4 className="font-semibold text-gray-700 text-sm">Messages personnalises (optionnel)</h4>
                {candidates
                  .filter((c) => getStatus(c) === "accepted" || getStatus(c) === "refused")
                  .map((c) => {
                    const st = getStatus(c);
                    return (
                      <div key={c.id} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-semibold text-sm text-gray-900">{c.firstName} {c.lastName}</span>
                          {statusBadge(st)}
                        </div>
                        <textarea
                          rows={2}
                          className="w-full border border-gray-200 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                          placeholder={`Message pour ${c.firstName}...`}
                          value={validateMessages[c.id] || ""}
                          onChange={(e) => setValidateMessages((prev) => ({ ...prev, [c.id]: e.target.value }))}
                        />
                      </div>
                    );
                  })}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => setShowValidateModal(false)}
                  className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all"
                >
                  Annuler
                </button>
                <button
                  onClick={handleValidateAndSend}
                  className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-all"
                >
                  Confirmer et Envoyer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
