"use client";

import { useState, useEffect, useMemo, useCallback } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/context/SettingsContext';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { startOfWeek, addDays, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Loader2, Save, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/components/ui/toast';

export default function AvailabilityPage() {
    const { user } = useAuth();
    const { settings } = useSettings();
    const { slotDuration } = settings;
    const { toast } = useToast();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saisieOuverte, setSaisieOuverte] = useState(true);

    const [weekOffset, setWeekOffset] = useState(0);

    // Calculate start of the viewed week based on offset
    const currentWeekStart = useMemo(() => {
        const start = startOfWeek(new Date(), { weekStartsOn: 1 });
        return addDays(start, weekOffset * 7);
    }, [weekOffset]);

    const days = useMemo(() => Array.from({ length: 5 }).map((_, i) => addDays(currentWeekStart, i)), [currentWeekStart]);

    // Store slots as simple objects { id, weekday: 1-5, startTime: "HH:mm", endTime: "HH:mm" }
    const [slots, setSlots] = useState<any[]>([]);

    const fetchAvailabilities = useCallback(async () => {
        setLoading(true);
        try {
            // Désactiver le cache pour charger les données à jour
            const fetchOptions = {
                headers: {
                    'Cache-Control': 'no-store, no-cache, must-revalidate',
                    'Pragma': 'no-cache',
                },
                params: { t: Date.now() }
            };

            const settingsRes = await api.get('/settings', fetchOptions);
            const saisieVal = settingsRes.data?.saisie_dispos_ouverte;
            setSaisieOuverte(saisieVal === 'true' || saisieVal === true);

            const startStr = format(currentWeekStart, 'yyyy-MM-dd');
            const endStr = format(addDays(currentWeekStart, 6), 'yyyy-MM-dd');

            const res = await api.get('/availability', {
                ...fetchOptions,
                params: { ...fetchOptions.params, start: startStr, end: endStr }
            });

            const data = res.data.map((s: any, i: number) => ({ ...s, id: s.id || `server-${i}` }));
            setSlots(data);
        } catch (e) {
            console.error(e);
            toast("Erreur de récupération de vos disponibilités", "error");
        } finally {
            setLoading(false);
        }
    }, [currentWeekStart, toast]);

    useEffect(() => {
        fetchAvailabilities();
    }, [fetchAvailabilities]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const startStr = format(currentWeekStart, 'yyyy-MM-dd');
            const endStr = format(addDays(currentWeekStart, 6), 'yyyy-MM-dd');

            const weekEnd = addDays(currentWeekStart, 6);
            const weekSlots = slots.filter(s => {
                if (s.date) {
                    const dStr = format(new Date(s.date), 'yyyy-MM-dd');
                    return dStr >= startStr && dStr <= endStr;
                }
                return true;
            });

            const payload = weekSlots.map(s => {
                let normalizedDate: string;
                if (s.date) {
                    // Normalize: use the date part + T12:00:00 to avoid TZ issues
                    const dStr = format(new Date(s.date), 'yyyy-MM-dd');
                    normalizedDate = new Date(dStr + 'T12:00:00').toISOString();
                } else if (s.weekday) {
                    const dayIndex = parseInt(s.weekday) - 1;
                    const d = addDays(currentWeekStart, dayIndex);
                    const dStr = format(d, 'yyyy-MM-dd');
                    normalizedDate = new Date(dStr + 'T12:00:00').toISOString();
                } else {
                    normalizedDate = new Date(startStr + 'T12:00:00').toISOString();
                }

                return {
                    weekday: String(s.weekday || '1'),
                    date: normalizedDate,
                    startTime: s.startTime,
                    endTime: s.endTime
                };
            });

            await api.put('/availability', {
                availabilities: payload,
                startDate: startStr,
                endDate: endStr
            });
            toast('Disponibilités enregistrées pour cette semaine !', 'success');
            fetchAvailabilities();
        } catch (e: any) {
            console.error(e);
            const msg = e.response?.data?.error || e.message || 'Erreur lors de la sauvegarde';
            toast(msg, 'error');
        } finally {
            setSaving(false);
        }
    };

    // Helper to generate time slots for a day
    const getDaySlots = (date: Date) => {
        const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const dayKey = dayKeys[date.getDay()];
        const dayConfig = settings.weeklySchedule?.[dayKey] || { start: settings.dayStart, end: settings.dayEnd, isOpen: true };

        if (!dayConfig.isOpen) return [];

        const timeSlots = [];
        let currentMinutes = dayConfig.start * 60;
        const endMinutes = dayConfig.end * 60;

        while (currentMinutes < endMinutes) {
            const h = Math.floor(currentMinutes / 60);
            const m = currentMinutes % 60;
            const startStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
            
            const nextMinutes = currentMinutes + slotDuration;
            const eH = Math.floor(nextMinutes / 60);
            const eM = nextMinutes % 60;
            const endStr = `${eH.toString().padStart(2, '0')}:${eM.toString().padStart(2, '0')}`;

            timeSlots.push({ start: startStr, end: endStr });
            currentMinutes = nextMinutes;
        }

        return timeSlots;
    };

    const toggleSlot = (date: Date, startTime: string, endTime: string) => {
        if (!saisieOuverte) {
            toast('Saisie clôturée. Lecture seule.', 'error');
            return;
        }

        const dateStr = format(date, 'yyyy-MM-dd');
        let weekday = date.getDay(); 
        if (weekday === 0) weekday = 7;

        // Chercher si le créneau existe déjà (pour le décocher)
        const exists = slots.find(s => {
            const slotDateStr = s.date ? format(new Date(s.date), 'yyyy-MM-dd') : null;
            if (slotDateStr) return slotDateStr === dateStr && s.startTime === startTime;
            if (s.weekday) return parseInt(s.weekday) === weekday && s.startTime === startTime;
            return false;
        });

        if (exists) {
            setSlots(slots.filter(s => s.id !== exists.id));
        } else {
            const normalizedDate = new Date(dateStr + 'T12:00:00');
            setSlots([...slots, {
                id: `local-${Date.now()}-${startTime}`,
                weekday: String(weekday),
                date: normalizedDate.toISOString(),
                startTime,
                endTime
            }]);
        }
    };

    const isSlotSelected = (date: Date, startTime: string) => {
        const dateStr = format(date, 'yyyy-MM-dd');
        let weekday = date.getDay(); 
        if (weekday === 0) weekday = 7;

        return slots.some(s => {
            const slotDateStr = s.date ? format(new Date(s.date), 'yyyy-MM-dd') : null;
            if (slotDateStr) return slotDateStr === dateStr && s.startTime === startTime;
            if (s.weekday) return parseInt(s.weekday) === weekday && s.startTime === startTime;
            return false;
        });
    };

    if (loading) return <div className="flex h-96 items-center justify-center flex-col gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-purple-600" />
        <p className="text-gray-500 font-medium">Chargement de votre planning...</p>
    </div>;

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] gap-6 p-4 md:p-8">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shrink-0">
                <div>
                    <h1 className="text-3xl font-black text-gray-900 flex items-center gap-3">
                        Mes Disponibilités
                        {!saisieOuverte && (
                            <span className="text-xs px-3 py-1 bg-red-100 text-red-700 rounded-full font-bold uppercase tracking-wide">Lecture Seule</span>
                        )}
                    </h1>
                    <p className="text-gray-500 mt-2 font-medium">Cochez simplement les créneaux où vous êtes disponible.</p>
                </div>
                
                <div className="flex items-center gap-4 bg-gray-50 p-2 rounded-xl border border-gray-100">
                    <Button variant="ghost" className="hover:bg-white" onClick={() => setWeekOffset(weekOffset - 1)} disabled={weekOffset <= 0}>&lt;</Button>
                    <span className="text-sm font-bold text-gray-700 w-36 text-center">
                        {format(currentWeekStart, 'd MMM', { locale: fr })} - {format(addDays(currentWeekStart, 4), 'd MMM', { locale: fr })}
                    </span>
                    <Button variant="ghost" className="hover:bg-white" onClick={() => setWeekOffset(weekOffset + 1)}>&gt;</Button>
                </div>
            </div>

            <div className="flex-1 overflow-x-auto overflow-y-hidden pb-4">
                <div className="flex gap-4 min-w-[1000px] h-full">
                    {days.map(day => {
                        const daySlots = getDaySlots(day);
                        return (
                            <div key={day.toISOString()} className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
                                <div className="p-4 border-b border-gray-100 bg-gray-50/50 text-center shrink-0">
                                    <div className="text-xs font-black text-gray-400 tracking-widest uppercase">{format(day, 'EEEE', { locale: fr })}</div>
                                    <div className="text-3xl font-black text-gray-800 mt-1">{format(day, 'd')}</div>
                                </div>
                                
                                <div className="flex-1 p-4 overflow-y-auto space-y-2">
                                    {daySlots.length === 0 ? (
                                        <div className="h-full flex items-center justify-center text-sm font-bold text-gray-400 uppercase tracking-widest">
                                            Fermé
                                        </div>
                                    ) : (
                                        daySlots.map((slot, i) => {
                                            const selected = isSlotSelected(day, slot.start);
                                            return (
                                                <button
                                                    key={`${slot.start}-${i}`}
                                                    onClick={() => toggleSlot(day, slot.start, slot.end)}
                                                    disabled={!saisieOuverte}
                                                    className={`w-full relative flex items-center justify-center py-4 rounded-xl font-bold text-sm transition-all duration-200 ${
                                                        selected
                                                            ? "bg-purple-100 border-2 border-purple-500 text-purple-700 shadow-[0_4px_14px_0_rgba(168,85,247,0.39)] hover:bg-purple-200"
                                                            : "bg-white border-2 border-gray-100 text-gray-400 hover:border-gray-300 hover:text-gray-600 shadow-sm"
                                                    } ${!saisieOuverte && "opacity-70 cursor-not-allowed"}`}
                                                >
                                                    {slot.start} - {slot.end}
                                                    {selected && <CheckCircle2 className="absolute right-4 w-5 h-5 text-purple-500" />}
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {saisieOuverte && (
                <div className="shrink-0 bg-white border border-gray-100 p-4 rounded-2xl shadow-lg flex justify-between items-center sticky bottom-6 z-50">
                    <p className="text-sm font-semibold text-gray-500 px-4">
                        N&apos;oubliez pas d&apos;enregistrer vos modifications une fois terminé.
                    </p>
                    <Button 
                        size="lg"
                        onClick={handleSave} 
                        disabled={saving} 
                        className="bg-black hover:bg-gray-800 text-white font-bold px-8 rounded-xl shadow-xl transition-all active:scale-95 flex items-center gap-3"
                    >
                        {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                        {saving ? "Enregistrement..." : "Enregistrer mes disponibilités"}
                    </Button>
                </div>
            )}
        </div>
    );
}
