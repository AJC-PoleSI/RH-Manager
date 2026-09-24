"use client";

// Statut du candidat connecté : encore en lice, ou refusé à un tour.
//
// Lu une fois par l'espace candidat (layout) et partagé avec la sidebar et le
// garde des pages. Le hook ne lève pas d'erreur hors du provider : la sidebar
// est commune aux membres, qui n'ont pas de statut candidat.

import React, { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";

export interface CandidateStatus {
  eliminated: boolean;
  tour?: number;
  firstName?: string;
  message?: string;
}

interface CandidateStatusContextType {
  status: CandidateStatus | null;
  loading: boolean;
}

const CandidateStatusContext = createContext<
  CandidateStatusContextType | undefined
>(undefined);

export function CandidateStatusProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { token, role } = useAuth();
  const [status, setStatus] = useState<CandidateStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || role !== "candidate") return;
    let annule = false;
    api
      .get("/candidate-status")
      .then((res) => {
        if (!annule) setStatus(res.data || null);
      })
      .catch(() => {
        // Statut illisible : on n'enferme personne, le serveur garde de toute
        // façon les créneaux et les inscriptions des refusés.
        if (!annule) setStatus(null);
      })
      .finally(() => {
        if (!annule) setLoading(false);
      });
    return () => {
      annule = true;
    };
  }, [token, role]);

  return (
    <CandidateStatusContext.Provider value={{ status, loading }}>
      {children}
    </CandidateStatusContext.Provider>
  );
}

/** Statut du candidat, ou null hors de l'espace candidat. */
export function useCandidateStatus(): CandidateStatusContextType | null {
  return useContext(CandidateStatusContext) ?? null;
}
