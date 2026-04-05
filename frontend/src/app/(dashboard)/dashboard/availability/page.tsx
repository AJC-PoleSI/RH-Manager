"use client";

import { useState, useEffect, useMemo } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/context/SettingsContext'; // Import settings
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { CalendarColumn } from '@/components/calendar/CalendarColumn';
import { startOfWeek, addDays, format, setHours, setMinutes, addMinutes } from 'date-fns'; // Added addMinutes
import { fr } from 'date-fns/locale';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
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

    useEffect(() => {
        fetchAvailabilities();
    }, [currentWeekStart]); // Refetch when week changes

    const fetchAvailabilities = async () => {
        setLoading(true);
        try {
            // Check global settings
            const settingsRes = await api.get('/settings');
            const saisieVal = settingsRes.data?.saisie_dispos_ouverte;
            setSaisieOuverte(saisieVal === 'true' || saisieVal === true);

            const startStr = format(currentWeekStart, 'yyyy-MM-dd');
            const endStr = format(addDays(currentWeekStart, 6), 'yyyy-MM-dd');

            const res = await api.get('/availability', {
                params: { start: startStr, end: endStr }
            });

            const data = res.data.map((s: any, i: number) => ({ ...s, id: s.id || `server-${i}` }));
            setSlots(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

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

    // Transform slots to "events" for CalendarColumn
    const calendarEvents = useMemo(() => {
        if (!slots) return [];
        return slots.map(slot => {
            let dateStr = '';

            if (slot.date) {
                dateStr = format(new Date(slot.date), 'yyyy-MM-dd');
            } else if (slot.weekday) {
                const dayOffset = parseInt(slot.weekday) - 1;
                const date = addDays(currentWeekStart, dayOffset);
                dateStr = format(date, 'yyyy-MM-dd');
            }

            return {
                id: slot.id,
                title: 'Disponible',
                day: dateStr,
                startTime: slot.startTime,
                endTime: slot.endTime,
                isAvailability: true
            };
        });
    }, [slots, currentWeekStart]);

    const handleSlotClick = (date: Date, hour: number, minute: number) => {
        if (!saisieOuverte) {
            toast('La saisie des disponibilités est terminée. Vous etes en mode lecture seule.', 'error');
            return;
        }

        // Calculate weekday from date (1=Mon)
        let weekday = date.getDay(); // 0=Sun
        if (weekday === 0) weekday = 7;

        const dateStr = format(date, 'yyyy-MM-dd');

        // Calculate precise start/end strings based on clicked time and global SlotDuration
        const startTimeDate = setMinutes(setHours(date, hour), minute);
        const endTimeDate = addMinutes(startTimeDate, slotDuration);

        const start = format(startTimeDate, 'HH:mm');
        const end = format(endTimeDate, 'HH:mm');

        // Check if slot exists (exact match for toggle)
        const exists = slots.find(s => {
            const slotDateStr = s.date ? format(new Date(s.date), 'yyyy-MM-dd') : null;
            if (slotDateStr) return slotDateStr === dateStr && s.startTime === start;
            if (s.weekday) return parseInt(s.weekday) === weekday && s.startTime === start;
            return false;
        });

        if (exists) {
            setSlots(slots.filter(s => s.id !== exists.id));
        } else {
            // Use noon of the target date to avoid timezone offset issues
            const normalizedDate = new Date(dateStr + 'T12:00:00');
            setSlots([...slots, {
                id: `local-${Date.now()}`,
                weekday: String(weekday),
                date: normalizedDate.toISOString(),
                startTime: start,
                endTime: end
            }]);
        }
    };

    const handleEventClick = (event: any) => {
        if (!saisieOuverte) {
            toast('Saisie clôturée.', 'error');
            return;
        }
        const slot = slots.find(s => s.id === event.id);
        if (slot) {
            setSlots(slots.filter(s => s.id !== slot.id));
        }
    };

    if (loading) return <div className="flex h-96 items-center justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] gap-6">
            <Card className="flex-1 flex flex-col overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between border-b pb-4 shrink-0">
                    <div>
                        <CardTitle className="text-2xl flex items-center gap-2">
                            Mes Disponibilités
                            {!saisieOuverte && (
                                <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full font-semibold border border-red-200">Lecture Seule</span>
                            )}
                        </CardTitle>
                        <p className="text-sm text-gray-500 mt-1">Vos créneaux sont récurrents chaque semaine.</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
                            <Button variant="ghost" size="sm" onClick={() => setWeekOffset(weekOffset - 1)} disabled={weekOffset <= 0}>&lt;</Button>
                            <span className="text-sm font-medium w-32 text-center">
                                {format(currentWeekStart, 'd MMM', { locale: fr })} - {format(addDays(currentWeekStart, 4), 'd MMM', { locale: fr })}
                            </span>
                            <Button variant="ghost" size="sm" onClick={() => setWeekOffset(weekOffset + 1)}>&gt;</Button>
                        </div>
                        {saisieOuverte && (
                            <Button onClick={handleSave} disabled={saving} className="bg-black text-white hover:bg-gray-800 gap-2">
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Enregistrer
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="flex-1 p-0 overflow-hidden flex flex-col">
                    <div className="flex-1 overflow-y-auto flex">
                        {days.map(day => (
                            <CalendarColumn
                                key={day.toISOString()}
                                date={day}
                                events={calendarEvents}
                                onTimeSlotClick={handleSlotClick}
                                onEventClick={handleEventClick}
                            />
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
