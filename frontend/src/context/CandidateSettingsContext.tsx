"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

interface CandidateSettings {
  planningVisible: boolean;
  deadlineCandidats: string | null;
  raw: Record<string, string>;
}

interface CandidateSettingsContextType {
  settings: CandidateSettings;
  loading: boolean;
  refresh: () => Promise<void>;
}

const CandidateSettingsContext = createContext<CandidateSettingsContextType | undefined>(undefined);

export function CandidateSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<CandidateSettings>({
    planningVisible: false,
    deadlineCandidats: null,
    raw: {},
  });
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      const res = await api.get('/settings');
      const data: Record<string, string> = res.data || {};
      setSettings({
        planningVisible: data.planning_visible_candidats === 'true',
        deadlineCandidats: data.deadline_candidats || null,
        raw: data,
      });
    } catch {
      // leave defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <CandidateSettingsContext.Provider value={{ settings, loading, refresh: fetch }}>
      {children}
    </CandidateSettingsContext.Provider>
  );
}

export function useCandidateSettings() {
  const ctx = useContext(CandidateSettingsContext);
  if (!ctx) throw new Error('useCandidateSettings must be inside CandidateSettingsProvider');
  return ctx;
}
