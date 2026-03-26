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
  "VP",
];

export default function CandidateWishesPage() {
  const { user } = useAuth();
  const [poles, setPoles] = useState<string[]>(DEFAULT_POLES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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
          const remaining = DEFAULT_POLES.filter((p) => !ordered.includes(p));
          setPoles([...ordered, ...remaining]);
        }
      } catch {
        // Use default
      } finally {
        setLoading(false);
      }
    };
    fetchWishes();
  }, [user?.id]);

  const moveUp = (index: number) => {
    if (index === 0) return;
    const updated = [...poles];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    setPoles(updated);
    setSaved(false);
  };

  const moveDown = (index: number) => {
    if (index === poles.length - 1) return;
    const updated = [...poles];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    setPoles(updated);
    setSaved(false);
  };

  const handleSave = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      const wishes = poles.map((pole, index) => ({ pole, rank: index + 1 }));
      await api.put(`/wishes/${user.id}`, { wishes });
      setSaved(true);
    } catch {
      // Error
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Choix de pôle</h1>
        <p className="text-sm text-gray-500 mt-1">Classez vos préférences</p>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 bg-[#EFF6FF] border border-blue-200 rounded-[10px] p-[14px_16px]">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#2563EB"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="flex-shrink-0 mt-0.5"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <p className="text-sm text-[#2563EB]">
          Classez les pôles par ordre de préférence. Le pôle en tête sera votre premier choix.
        </p>
      </div>

      {/* Pole list */}
      <div className="space-y-2">
        {poles.map((pole, index) => (
          <div
            key={pole}
            className="flex items-center gap-3 bg-white border border-gray-200 rounded-[10px] p-[14px_16px]"
          >
            {/* Rank number */}
            <span
              className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold flex-shrink-0 ${
                index === 0
                  ? "bg-[#2563EB] text-white"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {index + 1}
            </span>

            {/* Pole name */}
            <span className="flex-1 text-sm font-medium text-gray-900">
              {pole}
            </span>

            {/* Reorder buttons */}
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
                disabled={index === poles.length - 1}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Descendre"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-6 py-2.5 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 ${
            saved
              ? "bg-[#16A34A] text-white"
              : "bg-[#2563EB] hover:bg-blue-700 text-white"
          }`}
        >
          {saving ? "Sauvegarde..." : saved ? "Sauvegardé" : "Sauvegarder"}
        </button>
      </div>
    </div>
  );
}
