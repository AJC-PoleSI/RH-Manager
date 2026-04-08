"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

interface SettingsContextType {
    settings: {
        // Computed min/max for compatibility
        dayStart: number;
        dayEnd: number;
        slotDuration: number;
        weeklySchedule: Record<string, { start: number; end: number; isOpen: boolean }>;
    };
    updateSettings: (newSettings: Partial<SettingsContextType['settings']>) => Promise<void>;
    refreshSettings: () => Promise<void>;
    loading: boolean;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider = ({ children }: { children: React.ReactNode }) => {
    const [settings, setSettings] = useState({
        dayStart: 8,
        dayEnd: 19,
        slotDuration: 60,
        weeklySchedule: {
            mon: { start: 8, end: 19, isOpen: true },
            tue: { start: 8, end: 19, isOpen: true },
            wed: { start: 8, end: 19, isOpen: true },
            thu: { start: 8, end: 19, isOpen: true },
            fri: { start: 8, end: 19, isOpen: true },
            sat: { start: 8, end: 19, isOpen: false },
            sun: { start: 8, end: 19, isOpen: false },
        } as Record<string, { start: number; end: number; isOpen: boolean }>
    });
    const [loading, setLoading] = useState(true);

    const fetchSettings = useCallback(async () => {
        try {
            const res = await api.get('/settings');
            const data = res.data;

            setSettings(prev => {
                let weeklySchedule = prev.weeklySchedule;
                if (data.weeklySchedule) {
                    try {
                        weeklySchedule = JSON.parse(data.weeklySchedule);
                    } catch (e) {
                        console.error("Error parsing weeklySchedule", e);
                    }
                }

                // Compute min/max for backward compatibility
                const days = Object.values(weeklySchedule).filter(d => d.isOpen);
                const computedStart = days.length > 0 ? Math.min(...days.map(d => d.start)) : 8;
                const computedEnd = days.length > 0 ? Math.max(...days.map(d => d.end)) : 19;

                return {
                    dayStart: computedStart,
                    dayEnd: computedEnd,
                    slotDuration: parseInt(data.slotDuration) || 60,
                    weeklySchedule
                };
            });
        } catch (error) {
            console.error('Failed to load settings', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSettings();
    }, [fetchSettings]);

    const updateSettings = useCallback(async (newSettings: Partial<typeof settings>) => {
        try {
            await api.put('/settings', newSettings);
            setSettings(prev => ({ ...prev, ...newSettings }));
        } catch (error) {
            console.error('Failed to update settings', error);
            throw error;
        }
    }, []);

    return (
        <SettingsContext.Provider value={{ settings, updateSettings, refreshSettings: fetchSettings, loading }}>
            {children}
        </SettingsContext.Provider>
    );
};

export const useSettings = () => {
    const context = useContext(SettingsContext);
    if (!context) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
};
