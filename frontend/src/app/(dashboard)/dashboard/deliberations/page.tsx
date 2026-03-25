"use client";

import { useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

interface Candidate {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  formation?: string;
  evaluations?: Evaluation[];
  deliberation?: Deliberation;
}

interface Evaluation {
  id: string;
  scores: any;
  comment?: string;
  epreuve?: { name: string; tour: number };
  member?: { email: string };
}

interface Deliberation {
  tour1Status?: string;
  tour2Status?: string;
  tour3Status?: string;
  prosComment?: string;
  consComment?: string;
}

interface ReserveData {
  [candidateId: string]: { pros: string; cons: string };
}

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

  const tourKey = `tour${selectedTour}Status` as keyof Deliberation;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/deliberations");
      setCandidates(Array.isArray(res.data) ? res.data : []);
    } catch {
      try {
        const res = await api.get("/candidates?limit=1000");
        const list = Array.isArray(res.data)
          ? res.data
          : res.data.data || [];
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

  const getStatus = (c: Candidate) => c.deliberation?.[tourKey] || "";

  const handleDecision = async (
    candidateId: string,
    decision: string
  ) => {
    const current = candidates.find((c) => c.id === candidateId);
    const currentStatus = current?.deliberation?.[tourKey];

    // Toggle off if clicking the same button
    const newStatus = currentStatus === decision ? "" : decision;

    try {
      const payload: any = { [tourKey]: newStatus || "pending" };

      // Include reserve notes if setting to waiting
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
                  ? {
                      prosComment: reserveNotes[candidateId].pros,
                      consComment: reserveNotes[candidateId].cons,
                    }
                  : {}),
              },
            };
          }
          return c;
        })
      );
    } catch (e) {
      console.error("Failed to update deliberation:", e);
    }
  };

  const cancelDecision = async (candidateId: string) => {
    try {
      await api.put(`/deliberations/${candidateId}`, {
        [tourKey]: "pending",
      });
      setCandidates((prev) =>
        prev.map((c) => {
          if (c.id === candidateId) {
            return {
              ...c,
              deliberation: {
                ...c.deliberation,
                [tourKey]: undefined,
              },
            };
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

  const updateReserveNote = (
    candidateId: string,
    field: "pros" | "cons",
    value: string
  ) => {
    setReserveNotes((prev) => ({
      ...prev,
      [candidateId]: {
        pros: prev[candidateId]?.pros || "",
        cons: prev[candidateId]?.cons || "",
        [field]: value,
      },
    }));
  };

  // Save reserve notes when they change (debounced via blur)
  const saveReserveNotes = async (candidateId: string) => {
    const notes = reserveNotes[candidateId];
    if (!notes) return;
    try {
      await api.put(`/deliberations/${candidateId}`, {
        prosComment: notes.pros,
        consComment: notes.cons,
      });
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
        const scores =
          typeof ev.scores === "string" ? JSON.parse(ev.scores) : ev.scores;
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

  const getEvalCount = (c: Candidate): number =>
    c.evaluations?.length || 0;

  const getInitials = (c: Candidate) =>
    `${(c.firstName || "")[0] || ""}${(c.lastName || "")[0] || ""}`.toUpperCase();

  // Stats
  const reserveCandidates = candidates.filter(
    (c) => getStatus(c) === "waiting"
  );
  const acceptedCount = candidates.filter(
    (c) => getStatus(c) === "accepted"
  ).length;
  const refusedCount = candidates.filter(
    (c) => getStatus(c) === "refused"
  ).length;

  const handleValidateAndSend = async () => {
    try {
      await api.post("/deliberations/validate", {
        tour: selectedTour,
        messages: validateMessages,
      });
      setShowValidateModal(false);
      setValidateMessages({});
      loadData();
    } catch (e) {
      console.error("Failed to validate:", e);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-400 text-lg">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Soir&eacute;e D&eacute;bat
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          D&eacute;lib&eacute;ration de fin de tour
        </p>
      </div>

      {/* Tour Selector */}
      <div className="flex items-center gap-3">
        {[1, 2, 3].map((t) => (
          <button
            key={t}
            onClick={() => setSelectedTour(t)}
            className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              selectedTour === t
                ? "bg-white border-2 text-[#2563EB] shadow-sm"
                : "bg-white border border-gray-200 text-gray-500 hover:border-gray-300"
            }`}
            style={
              selectedTour === t ? { borderColor: "#2563EB" } : undefined
            }
          >
            Tour {t}
          </button>
        ))}
      </div>

      {/* Candidates Section Card */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        {/* Section Header */}
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">
            &#128101; Revue des candidats ({candidates.length})
          </h2>
        </div>

        {/* Info Banner */}
        <div className="mx-6 mt-4 mb-2 px-4 py-3 rounded-lg bg-[#EFF6FF] border border-blue-200">
          <p className="text-sm text-[#2563EB]">
            Cliquez une 2&egrave;me fois sur un bouton d&eacute;j&agrave;
            s&eacute;lectionn&eacute; pour le d&eacute;s&eacute;lectionner.
          </p>
        </div>

        {/* Candidate List */}
        <div className="p-6 space-y-4">
          {candidates.map((c) => {
            const status = getStatus(c);
            const isReserve = status === "waiting";

            return (
              <div
                key={c.id}
                className="border border-gray-200 rounded-xl p-5 space-y-4"
              >
                {/* Candidate Info Row */}
                <div className="flex items-center gap-4">
                  {/* Avatar */}
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                    style={{ backgroundColor: "#2563EB" }}
                  >
                    {getInitials(c)}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-gray-900">
                        {c.firstName} {c.lastName}
                      </span>
                      {status === "accepted" && (
                        <span
                          className="text-xs font-semibold px-2.5 py-1 rounded-full"
                          style={{
                            backgroundColor: "#DCFCE7",
                            color: "#16A34A",
                          }}
                        >
                          Passe
                        </span>
                      )}
                      {status === "refused" && (
                        <span
                          className="text-xs font-semibold px-2.5 py-1 rounded-full"
                          style={{
                            backgroundColor: "#FFF0F3",
                            color: "#E8446A",
                          }}
                        >
                          &Eacute;limin&eacute;
                        </span>
                      )}
                      {status === "waiting" && (
                        <span
                          className="text-xs font-semibold px-2.5 py-1 rounded-full"
                          style={{
                            backgroundColor: "#FEF9C3",
                            color: "#CA8A04",
                          }}
                        >
                          R&eacute;serve
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500 mt-0.5">
                      {c.formation || "Formation non renseign&eacute;e"}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-400 mt-1">
                      <span>
                        Moyenne : <strong>{getAvgScore(c)}</strong>
                      </span>
                      <span>
                        {getEvalCount(c)} &eacute;valuation
                        {getEvalCount(c) !== 1 ? "s" : ""}
                      </span>
                      <a
                        href={`/dashboard/candidates/${c.id}`}
                        className="underline hover:text-[#2563EB]"
                      >
                        voir fiche
                      </a>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Passe */}
                  <button
                    onClick={() => handleDecision(c.id, "accepted")}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold border-2 transition-all ${
                      status === "accepted"
                        ? "text-white"
                        : "bg-white hover:bg-green-50"
                    }`}
                    style={
                      status === "accepted"
                        ? {
                            backgroundColor: "#16A34A",
                            borderColor: "#16A34A",
                            color: "white",
                          }
                        : { borderColor: "#16A34A", color: "#16A34A" }
                    }
                  >
                    &#10003; Passe
                  </button>

                  {/* Réserve */}
                  <button
                    onClick={() => handleDecision(c.id, "waiting")}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold border-2 transition-all ${
                      status === "waiting"
                        ? "text-white"
                        : "bg-white hover:bg-yellow-50"
                    }`}
                    style={
                      status === "waiting"
                        ? {
                            backgroundColor: "#CA8A04",
                            borderColor: "#CA8A04",
                            color: "white",
                          }
                        : { borderColor: "#CA8A04", color: "#CA8A04" }
                    }
                  >
                    ? R&eacute;serve
                  </button>

                  {/* Éliminé */}
                  <button
                    onClick={() => handleDecision(c.id, "refused")}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold border-2 transition-all ${
                      status === "refused"
                        ? "text-white"
                        : "bg-white hover:bg-pink-50"
                    }`}
                    style={
                      status === "refused"
                        ? {
                            backgroundColor: "#E8446A",
                            borderColor: "#E8446A",
                            color: "white",
                          }
                        : { borderColor: "#E8446A", color: "#E8446A" }
                    }
                  >
                    &#10007; &Eacute;limin&eacute;
                  </button>

                  {/* Annuler - only if decision made */}
                  {status &&
                    status !== "pending" && (
                      <button
                        onClick={() => cancelDecision(c.id)}
                        className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-300 text-gray-500 bg-white hover:bg-gray-50 transition-all"
                      >
                        &#10005; Annuler
                      </button>
                    )}
                </div>

                {/* Reserve Notes - 2 column textarea grid */}
                {isReserve && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                    <div>
                      <label
                        className="block text-sm font-semibold mb-1"
                        style={{ color: "#16A34A" }}
                      >
                        Points +
                      </label>
                      <textarea
                        rows={3}
                        className="w-full border rounded-lg p-3 text-sm focus:outline-none focus:ring-2"
                        style={{
                          borderColor: "#16A34A",
                          outlineColor: "#16A34A",
                        }}
                        placeholder="Points positifs du candidat..."
                        value={
                          reserveNotes[c.id]?.pros ||
                          c.deliberation?.prosComment ||
                          ""
                        }
                        onChange={(e) =>
                          updateReserveNote(c.id, "pros", e.target.value)
                        }
                        onBlur={() => saveReserveNotes(c.id)}
                      />
                    </div>
                    <div>
                      <label
                        className="block text-sm font-semibold mb-1"
                        style={{ color: "#E8446A" }}
                      >
                        Points &minus;
                      </label>
                      <textarea
                        rows={3}
                        className="w-full border rounded-lg p-3 text-sm focus:outline-none focus:ring-2"
                        style={{
                          borderColor: "#E8446A",
                        }}
                        placeholder="Points n&eacute;gatifs du candidat..."
                        value={
                          reserveNotes[c.id]?.cons ||
                          c.deliberation?.consComment ||
                          ""
                        }
                        onChange={(e) =>
                          updateReserveNote(c.id, "cons", e.target.value)
                        }
                        onBlur={() => saveReserveNotes(c.id)}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {candidates.length === 0 && (
            <div className="text-center text-gray-400 py-12">
              Aucun candidat trouv&eacute;.
            </div>
          )}
        </div>
      </div>

      {/* Bottom Action Buttons */}
      <div className="flex items-center justify-end gap-3">
        <button
          onClick={() => setShowReserveModal(true)}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all"
        >
          &#128064; Voir les r&eacute;serves
        </button>
        <button
          onClick={() => setShowValidateModal(true)}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-all"
          style={{ backgroundColor: "#2563EB" }}
        >
          &#9989; Valider &amp; Envoyer
        </button>
      </div>

      {/* Reserve Modal */}
      {showReserveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto mx-4">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">
                &#128064; Candidats en r&eacute;serve ({reserveCandidates.length})
              </h3>
              <button
                onClick={() => setShowReserveModal(false)}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold"
              >
                &#10005;
              </button>
            </div>
            <div className="p-6 space-y-4">
              {reserveCandidates.length === 0 && (
                <p className="text-center text-gray-400 py-8">
                  Aucun candidat en r&eacute;serve pour ce tour.
                </p>
              )}
              {reserveCandidates.map((c) => (
                <div
                  key={c.id}
                  className="border border-gray-200 rounded-xl p-4"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-xs"
                      style={{ backgroundColor: "#2563EB" }}
                    >
                      {getInitials(c)}
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">
                        {c.firstName} {c.lastName}
                      </div>
                      <div className="text-xs text-gray-500">
                        {c.formation || ""}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div
                      className="rounded-lg p-3 text-sm"
                      style={{ backgroundColor: "#DCFCE7" }}
                    >
                      <div
                        className="font-semibold text-xs mb-1"
                        style={{ color: "#16A34A" }}
                      >
                        Points +
                      </div>
                      <p className="text-gray-700">
                        {reserveNotes[c.id]?.pros ||
                          c.deliberation?.prosComment ||
                          "Aucun commentaire"}
                      </p>
                    </div>
                    <div
                      className="rounded-lg p-3 text-sm"
                      style={{ backgroundColor: "#FFF0F3" }}
                    >
                      <div
                        className="font-semibold text-xs mb-1"
                        style={{ color: "#E8446A" }}
                      >
                        Points &minus;
                      </div>
                      <p className="text-gray-700">
                        {reserveNotes[c.id]?.cons ||
                          c.deliberation?.consComment ||
                          "Aucun commentaire"}
                      </p>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto mx-4">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">
                &#9989; Valider &amp; Envoyer
              </h3>
              <button
                onClick={() => setShowValidateModal(false)}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold"
              >
                &#10005;
              </button>
            </div>
            <div className="p-6 space-y-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 gap-4">
                <div
                  className="rounded-xl p-4 text-center"
                  style={{ backgroundColor: "#DCFCE7" }}
                >
                  <div
                    className="text-3xl font-bold"
                    style={{ color: "#16A34A" }}
                  >
                    {acceptedCount}
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    Admis
                  </div>
                </div>
                <div
                  className="rounded-xl p-4 text-center"
                  style={{ backgroundColor: "#FFF0F3" }}
                >
                  <div
                    className="text-3xl font-bold"
                    style={{ color: "#E8446A" }}
                  >
                    {refusedCount}
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    &Eacute;limin&eacute;s
                  </div>
                </div>
              </div>

              {/* Message textareas per candidate with decision */}
              <div className="space-y-4">
                <h4 className="font-semibold text-gray-700 text-sm">
                  Messages personnalis&eacute;s (optionnel)
                </h4>
                {candidates
                  .filter(
                    (c) =>
                      getStatus(c) === "accepted" ||
                      getStatus(c) === "refused"
                  )
                  .map((c) => {
                    const st = getStatus(c);
                    return (
                      <div
                        key={c.id}
                        className="border border-gray-200 rounded-lg p-4"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-semibold text-sm text-gray-900">
                            {c.firstName} {c.lastName}
                          </span>
                          {st === "accepted" && (
                            <span
                              className="text-xs font-semibold px-2 py-0.5 rounded-full"
                              style={{
                                backgroundColor: "#DCFCE7",
                                color: "#16A34A",
                              }}
                            >
                              Admis
                            </span>
                          )}
                          {st === "refused" && (
                            <span
                              className="text-xs font-semibold px-2 py-0.5 rounded-full"
                              style={{
                                backgroundColor: "#FFF0F3",
                                color: "#E8446A",
                              }}
                            >
                              &Eacute;limin&eacute;
                            </span>
                          )}
                        </div>
                        <textarea
                          rows={2}
                          className="w-full border border-gray-200 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                          placeholder={`Message pour ${c.firstName}...`}
                          value={validateMessages[c.id] || ""}
                          onChange={(e) =>
                            setValidateMessages((prev) => ({
                              ...prev,
                              [c.id]: e.target.value,
                            }))
                          }
                        />
                      </div>
                    );
                  })}
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => setShowValidateModal(false)}
                  className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all"
                >
                  Annuler
                </button>
                <button
                  onClick={handleValidateAndSend}
                  className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-all"
                  style={{ backgroundColor: "#2563EB" }}
                >
                  &#9989; Confirmer &amp; Envoyer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
