"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";

const DEFAULT_POLES = [
  "Système d'information",
  "Marketing",
  "Développement commercial",
  "Audit Qualité",
  "Ressource Humaine",
  "Trésorerie",
  "Bureau - VP",
  "Bureau - Président",
  "Bureau - Trésorier",
  "Bureau - Secrétaire générale",
];

type Tour = { id: string; name: string; status: string };

function extractTourNumber(name: string): number {
  const match = name.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

export default function CandidateWishesPage() {
  const { user } = useAuth();
  const [selectedPoles, setSelectedPoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTourNumber, setActiveTourNumber] = useState<number>(0);
  const [activeTourStatus, setActiveTourStatus] = useState<string>("");

  // Determine active tour
  useEffect(() => {
    const fetchTours = async () => {
      try {
        const res = await api.get("/tours");
        const tours: Tour[] = res.data || [];
        const enCours = tours.find((t) => t.status === "en_cours");
        if (enCours) {
          setActiveTourNumber(extractTourNumber(enCours.name));
          setActiveTourStatus("en_cours");
        } else {
          // If no tour is en_cours, check for the last completed one
          const termine = tours
            .filter((t) => t.status === "termine")
            .sort((a, b) => extractTourNumber(b.name) - extractTourNumber(a.name));
          if (termine.length > 0) {
            setActiveTourNumber(extractTourNumber(termine[0].name));
            setActiveTourStatus("termine");
          } else {
            // All tours are a_venir — default to tour 1
            setActiveTourNumber(1);
            setActiveTourStatus("a_venir");
          }
        }
      } catch {
        // Fallback: no tour info, show tour 1 behavior
        setActiveTourNumber(1);
        setActiveTourStatus("a_venir");
      }
    };
    fetchTours();
  }, []);

  // Fetch existing wishes
  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    const fetchWishes = async () => {
      try {
        const res = await api.get(`/wishes/${user.id}`);
        if (res.data && res.data.length > 0) {
          const ordered = res.data
            .sort((a: any, b: any) => a.rank - b.rank)
            .map((w: any) => w.pole);
          setSelectedPoles(ordered.slice(0, 3)); // Only keep top 3
        }
      } catch {
        // No existing wishes
      } finally {
        setLoading(false);
      }
    };
    fetchWishes();
  }, [user?.id]);

  const isDefinitif = activeTourNumber >= 3;
  const canRank = activeTourNumber >= 2;
  const isTourTermine = activeTourStatus === "termine";

  const addPole = (pole: string) => {
    if (selectedPoles.length >= 3 || selectedPoles.includes(pole)) return;
    setSelectedPoles([...selectedPoles, pole]);
    setSaved(false);
  };

  const removePole = (index: number) => {
    setSelectedPoles(selectedPoles.filter((_, i) => i !== index));
    setSaved(false);
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const updated = [...selectedPoles];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    setSelectedPoles(updated);
    setSaved(false);
  };

  const moveDown = (index: number) => {
    if (index === selectedPoles.length - 1) return;
    const updated = [...selectedPoles];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    setSelectedPoles(updated);
    setSaved(false);
  };

  const handleSave = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      const wishes = selectedPoles.map((pole, index) => ({ pole, rank: index + 1 }));
      await api.put(`/wishes/${user.id}`, { wishes });
      setSaved(true);
    } catch {
      // Error
    } finally {
      setSaving(false);
    }
  };

  const availablePoles = DEFAULT_POLES.filter((p) => !selectedPoles.includes(p));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  // Tour 1: informational message only, no ranking
  if (activeTourNumber <= 1) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Choix de pôle</h1>
          <p className="text-sm text-gray-500 mt-1">Tour 1 — Choix à titre indicatif</p>
        </div>

        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <div className="text-sm text-amber-800">
            <p className="font-semibold mb-1">Le choix des pôles n&apos;est pas encore ouvert</p>
            <p>
              Durant le Tour 1, les choix de pôle sont à titre indicatif uniquement.
              Le classement de vos préférences sera disponible à partir du Tour 2.
            </p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Pôles disponibles</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {DEFAULT_POLES.map((pole) => (
              <div
                key={pole}
                className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg text-sm text-gray-600"
              >
                <span className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />
                {pole}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Tour 2+ : ranking top 3 poles
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Choix de pôle</h1>
        <p className="text-sm text-gray-500 mt-1">
          Tour {activeTourNumber} — {isDefinitif ? "Choix définitif" : "À titre indicatif"}
        </p>
      </div>

      {/* Info banner */}
      <div className={`flex items-start gap-3 rounded-xl p-4 border ${
        isDefinitif
          ? "bg-red-50 border-red-200"
          : "bg-blue-50 border-blue-200"
      }`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={isDefinitif ? "#DC2626" : "#2563EB"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <div className={`text-sm ${isDefinitif ? "text-red-800" : "text-blue-800"}`}>
          {isDefinitif ? (
            <>
              <p className="font-semibold mb-1">Choix définitif</p>
              <p>
                Classez vos <strong>3 pôles préférés</strong> par ordre de préférence.
                Ce classement est <strong>définitif</strong> et sera utilisé pour votre affectation.
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold mb-1">Choix à titre indicatif</p>
              <p>
                Classez vos <strong>3 pôles préférés</strong> par ordre de préférence.
                Ce classement est encore indicatif et pourra être modifié au Tour 3.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Selected poles (top 3) */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Vos choix ({selectedPoles.length}/3)
        </h2>

        {selectedPoles.length === 0 ? (
          <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center text-sm text-gray-400">
            Sélectionnez 3 pôles dans la liste ci-dessous
          </div>
        ) : (
          <div className="space-y-2">
            {selectedPoles.map((pole, index) => (
              <div
                key={pole}
                className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl p-4"
              >
                {/* Rank badge */}
                <span
                  className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold flex-shrink-0 ${
                    index === 0
                      ? "bg-yellow-400 text-yellow-900"
                      : index === 1
                      ? "bg-gray-300 text-gray-700"
                      : "bg-amber-600 text-white"
                  }`}
                >
                  {index + 1}
                </span>

                {/* Pole name */}
                <span className="flex-1 text-sm font-medium text-gray-900">
                  {pole}
                </span>

                {/* Reorder buttons */}
                {!isTourTermine && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => moveUp(index)}
                      disabled={index === 0}
                      className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      aria-label="Monter"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="18 15 12 9 6 15" />
                      </svg>
                    </button>
                    <button
                      onClick={() => moveDown(index)}
                      disabled={index === selectedPoles.length - 1}
                      className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      aria-label="Descendre"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    <button
                      onClick={() => removePole(index)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
                      aria-label="Retirer"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Available poles to select */}
      {!isTourTermine && selectedPoles.length < 3 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Pôles disponibles
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {availablePoles.map((pole) => (
              <button
                key={pole}
                onClick={() => addPole(pole)}
                className="flex items-center gap-2 p-3 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:border-blue-300 hover:bg-blue-50 transition-colors text-left"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
                {pole}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* All poles shown when 3 are selected */}
      {!isTourTermine && selectedPoles.length >= 3 && availablePoles.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Autres pôles
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {availablePoles.map((pole) => (
              <div
                key={pole}
                className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg text-sm text-gray-400"
              >
                <span className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />
                {pole}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Save button */}
      {!isTourTermine && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving || selectedPoles.length === 0}
            className={`px-6 py-2.5 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 ${
              saved
                ? "bg-green-600 text-white"
                : isDefinitif
                ? "bg-red-600 hover:bg-red-700 text-white"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            {saving
              ? "Sauvegarde..."
              : saved
              ? "Sauvegardé ✓"
              : isDefinitif
              ? "Confirmer mes choix définitifs"
              : "Sauvegarder"}
          </button>
        </div>
      )}

      {/* Tour terminé message */}
      {isTourTermine && (
        <div className="flex items-start gap-3 bg-gray-50 border border-gray-200 rounded-xl p-4">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <p className="text-sm text-gray-600">
            Ce tour est terminé. Vos choix ont été enregistrés et ne peuvent plus être modifiés.
          </p>
        </div>
      )}
    </div>
  );
}
