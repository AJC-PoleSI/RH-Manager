"use client";

// Planning d'un candidat — « il passe quand, où, et avec qui ? »
//
// Affiché sur la fiche candidat (panneau de la liste + page détail atteinte
// depuis le trombinoscope). Les données viennent de
// GET /api/candidates/[id]/slots, réservé au staff : la composition du jury
// ne doit jamais être servie au candidat lui-même.

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { CalendarDays, Loader2, MapPin, Users } from "lucide-react";

export interface CandidateSlot {
  slotId: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  room: string | null;
  label: string | null;
  slotStatus: string | null;
  tour: number | null;
  epreuve: {
    id: string;
    name: string;
    tour: number;
    type: string;
    isGroupEpreuve: boolean;
  } | null;
  examiners: { id: string; email: string; name: string }[];
}

/** Même vocabulaire que le planning admin, pour ne pas inventer un 2e lexique. */
const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  open: "Ouvert",
  ready: "Prêt",
  published: "Publié",
  full: "Complet",
  closed: "Clôturé",
};

function formatDate(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "Date inconnue";
  return d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export default function CandidateSlots({
  candidateId,
  className = "",
}: {
  candidateId: string;
  className?: string;
}) {
  const [slots, setSlots] = useState<CandidateSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!candidateId) return;
    let cancelled = false;

    setLoading(true);
    setError(null);
    api
      .get(`/candidates/${candidateId}/slots`)
      .then((res) => {
        if (cancelled) return;
        setSlots(Array.isArray(res.data) ? res.data : []);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setSlots([]);
        setError(
          e?.response?.data?.error || "Impossible de charger les créneaux.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [candidateId]);

  // Regroupement par tour : c'est la lecture naturelle du recrutement.
  const byTour = new Map<number, CandidateSlot[]>();
  for (const s of slots) {
    const tour = s.epreuve?.tour ?? s.tour ?? 0;
    const list = byTour.get(tour) || [];
    list.push(s);
    byTour.set(tour, list);
  }
  const tours = Array.from(byTour.keys()).sort((a, b) => a - b);

  return (
    <div
      className={`rounded-lg border border-gray-100 bg-white shadow-sm ${className}`}
    >
      <div className="flex items-center justify-between p-5 pb-3">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <CalendarDays size={18} className="text-primary-500" />
          Créneaux ({slots.length})
        </h2>
      </div>

      {loading ? (
        <div className="p-8 flex justify-center">
          <Loader2 className="animate-spin text-primary-500" />
        </div>
      ) : error ? (
        <p className="px-5 pb-5 text-sm text-red-600">{error}</p>
      ) : slots.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-gray-400">
          Aucun créneau : ce candidat n&apos;est inscrit à aucun entretien pour
          le moment. (L&apos;épreuve commune se passe sans créneau.)
        </p>
      ) : (
        <div className="divide-y divide-gray-100 border-t border-gray-100">
          {tours.map((tour) => (
            <div key={tour} className="p-5 space-y-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                {tour ? `Tour ${tour}` : "Tour inconnu"}
              </p>

              {(byTour.get(tour) || []).map((s) => (
                <div
                  key={s.slotId}
                  className="rounded-lg border border-gray-100 bg-gray-50/60 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-gray-900">
                      {s.epreuve?.name || "Épreuve inconnue"}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {s.room && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium border border-indigo-100">
                          <MapPin size={11} />
                          {s.room}
                        </span>
                      )}
                      {s.slotStatus && s.slotStatus !== "published" && (
                        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[11px] font-medium">
                          {STATUS_LABELS[s.slotStatus] || s.slotStatus}
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="mt-1 text-sm text-gray-600 first-letter:uppercase">
                    {formatDate(s.date)}
                    {s.startTime && (
                      <>
                        {" · "}
                        {s.startTime}
                        {s.endTime ? ` – ${s.endTime}` : ""}
                      </>
                    )}
                    {s.label && (
                      <span className="text-gray-400"> · {s.label}</span>
                    )}
                  </p>

                  <div className="mt-2 flex items-start gap-1.5 text-xs text-gray-500">
                    <Users size={13} className="mt-0.5 shrink-0" />
                    {s.examiners.length > 0 ? (
                      <span>
                        <span className="text-gray-400">
                          Examinateur{s.examiners.length > 1 ? "s" : ""} :{" "}
                        </span>
                        <span className="font-medium text-gray-700">
                          {s.examiners.map((m) => m.name).join(" · ")}
                        </span>
                      </span>
                    ) : (
                      <span className="italic text-gray-400">
                        Aucun examinateur affecté pour l&apos;instant
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
