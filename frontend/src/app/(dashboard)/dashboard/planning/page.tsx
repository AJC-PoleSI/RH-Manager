"use client";

import { useState, useEffect, useMemo, useCallback } from 'react';
import { startOfWeek, addDays, format, addMinutes, setHours, setMinutes } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/context/SettingsContext';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
    ChevronLeft, ChevronRight, Plus, X, Check, Clock, Users,
    Loader2, Calendar, Save, Trash2, Eye, Lock, Unlock,
    AlertCircle, MapPin, Mail
} from 'lucide-react';

const HOUR_HEIGHT = 60;

// ---- STATUS COLORS & LABELS ----
const STATUS_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
    open: { bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-700', dot: 'bg-blue-500' },
    ready: { bg: 'bg-yellow-50', border: 'border-yellow-300', text: 'text-yellow-700', dot: 'bg-yellow-500' },
    published: { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-700', dot: 'bg-green-500' },
    full: { bg: 'bg-emerald-50', border: 'border-emerald-400', text: 'text-emerald-700', dot: 'bg-emerald-500' },
    closed: { bg: 'bg-gray-100', border: 'border-gray-300', text: 'text-gray-500', dot: 'bg-gray-400' },
    cancelled: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-400', dot: 'bg-red-300' },
};
const STATUS_LABELS: Record<string, string> = {
    open: 'En attente membres',
    ready: 'Pr\u00eat',
    published: 'Ouvert candidats',
    full: 'Complet',
    closed: 'Ferm\u00e9',
    cancelled: 'Annul\u00e9',
};
const STATUS_EMOJI: Record<string, string> = {
    open: '\uD83D\uDD35',
    ready: '\uD83D\uDFE1',
    published: '\uD83D\uDFE2',
    full: '\u2705',
    closed: '\u26AA',
    cancelled: '\u274C',
};

export default function PlanningPage() {
    const { user, role } = useAuth();
    const isAdmin = user?.isAdmin === true;
    const isCandidate = role === 'candidate';
    const isMember = role === 'member' && !isAdmin;
    const { settings } = useSettings();
    const { dayStart, dayEnd, slotDuration, weeklySchedule } = settings;
    const { toast } = useToast();

    // ---- STATE ----
    const [loading, setLoading] = useState(true);
    const [slots, setSlots] = useState<any[]>([]);
    const [weekOffset, setWeekOffset] = useState(0);
    const [showModal, setShowModal] = useState(false);
    const [editingSlot, setEditingSlot] = useState<any>(null);
    const [formData, setFormData] = useState({
        startTime: '09:00',
        duration: 60,
        simultaneousSlots: 1,
        minMembers: 1,
        maxCandidates: 1,
        label: '',
        room: '',
    });
    const [selectedDate, setSelectedDate] = useState<string>('');
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    // ---- WEEK NAVIGATION ----
    const currentWeekStart = useMemo(() => {
        const start = startOfWeek(new Date(), { weekStartsOn: 1 });
        return addDays(start, weekOffset * 7);
    }, [weekOffset]);

    // Mon-Fri + optionally Saturday morning
    const days = useMemo(() => {
        const result = [];
        for (let i = 0; i < 6; i++) { // Mon-Sat
            const d = addDays(currentWeekStart, i);
            result.push(d);
        }
        return result;
    }, [currentWeekStart]);

    // ---- DATA FETCHING ----
    const fetchSlots = useCallback(async () => {
        setLoading(true);
        try {
            const startStr = format(currentWeekStart, 'yyyy-MM-dd');
            const endStr = format(addDays(currentWeekStart, 6), 'yyyy-MM-dd');

            let url = '/slots/all';
            if (isCandidate) {
                url = '/slots/available';
            }

            const res = await api.get(url, { params: { start: startStr, end: endStr } });
            setSlots(res.data || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [currentWeekStart, isCandidate]);

    useEffect(() => { fetchSlots(); }, [fetchSlots]);

    // ---- ADMIN: CREATE SLOT ----
    const handleGridClick = (date: Date, hour: number, minute: number) => {
        if (!isAdmin) return;

        const startH = hour.toString().padStart(2, '0');
        const startM = minute.toString().padStart(2, '0');
        const endDate = addMinutes(setMinutes(setHours(new Date(), hour), minute), formData.duration || 60);
        const endH = endDate.getHours().toString().padStart(2, '0');
        const endM = endDate.getMinutes().toString().padStart(2, '0');

        setSelectedDate(format(date, 'yyyy-MM-dd'));
        setFormData({
            ...formData,
            startTime: `${startH}:${startM}`,
        });
        setEditingSlot(null);
        setShowModal(true);
    };

    const handleSaveSlot = async () => {
        if (!selectedDate) return;
        setActionLoading('save');

        const endDate = addMinutes(
            setMinutes(setHours(new Date(), parseInt(formData.startTime.split(':')[0])), parseInt(formData.startTime.split(':')[1])),
            formData.duration
        );
        const endTime = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;

        try {
            if (editingSlot) {
                await api.put(`/slots/${editingSlot.id}`, {
                    startTime: formData.startTime,
                    endTime,
                    durationMinutes: formData.duration,
                    simultaneousSlots: formData.simultaneousSlots,
                    minMembers: formData.minMembers,
                    maxCandidates: formData.maxCandidates,
                    label: formData.label || null,
                    room: formData.room || null,
                });
                toast('Cr\u00e9neau modifi\u00e9', 'success');
            } else {
                await api.post('/slots', {
                    date: selectedDate,
                    startTime: formData.startTime,
                    endTime,
                    durationMinutes: formData.duration,
                    simultaneousSlots: formData.simultaneousSlots,
                    minMembers: formData.minMembers,
                    maxCandidates: formData.maxCandidates,
                    label: formData.label || null,
                    room: formData.room || null,
                });
                toast('Cr\u00e9neau cr\u00e9\u00e9', 'success');
            }
            setShowModal(false);
            fetchSlots();
        } catch (e: any) {
            toast(e.response?.data?.error || 'Erreur', 'error');
        } finally {
            setActionLoading(null);
        }
    };

    const handleDeleteSlot = async (id: string) => {
        if (!confirm('Supprimer ce cr\u00e9neau ?')) return;
        setActionLoading(id);
        try {
            await api.delete(`/slots/${id}`);
            toast('Cr\u00e9neau supprim\u00e9', 'success');
            fetchSlots();
        } catch (e) {
            toast('Erreur suppression', 'error');
        } finally {
            setActionLoading(null);
        }
    };

    const handleEditSlot = (slot: any) => {
        if (!isAdmin) return;
        setEditingSlot(slot);
        setSelectedDate(format(new Date(slot.date), 'yyyy-MM-dd'));
        setFormData({
            startTime: slot.startTime,
            duration: slot.durationMinutes || 60,
            simultaneousSlots: slot.simultaneousSlots || 1,
            minMembers: slot.minMembers || 1,
            maxCandidates: slot.maxCandidates || 1,
            label: slot.label || '',
            room: slot.room || '',
        });
        setShowModal(true);
    };

    const handleStatusChange = async (slotId: string, newStatus: string) => {
        setActionLoading(slotId);
        try {
            await api.put(`/slots/${slotId}`, { status: newStatus });
            toast(`Statut mis \u00e0 jour : ${STATUS_LABELS[newStatus]}`, 'success');
            fetchSlots();
        } catch (e) {
            toast('Erreur', 'error');
        } finally {
            setActionLoading(null);
        }
    };

    // ---- MEMBER: TOGGLE AVAILABILITY ----
    const handleToggleMember = async (slotId: string) => {
        setActionLoading(slotId);
        try {
            const res = await api.post('/slots/toggle-member', { slotId });
            toast(res.data.action === 'added' ? 'Disponibilit\u00e9 signal\u00e9e !' : 'Disponibilit\u00e9 retir\u00e9e', 'success');
            fetchSlots();
        } catch (e: any) {
            toast(e.response?.data?.error || 'Erreur', 'error');
        } finally {
            setActionLoading(null);
        }
    };

    // ---- CANDIDATE: ENROLL/CANCEL ----
    const handleEnroll = async (slotId: string) => {
        if (!confirm('Confirmer votre inscription \u00e0 ce cr\u00e9neau ?')) return;
        setActionLoading(slotId);
        try {
            await api.post('/slots/enroll', { slotId });
            toast('Inscription confirm\u00e9e !', 'success');
            fetchSlots();
        } catch (e: any) {
            toast(e.response?.data?.error || "Erreur lors de l'inscription", 'error');
        } finally {
            setActionLoading(null);
        }
    };

    const handleCancelEnroll = async (slotId: string) => {
        if (!confirm('\u00cates-vous s\u00fbr de vouloir vous d\u00e9sinscrire ?')) return;
        setActionLoading(slotId);
        try {
            await api.delete(`/slots/enroll/${slotId}`);
            toast('D\u00e9sinscription effectu\u00e9e', 'success');
            fetchSlots();
        } catch (e: any) {
            toast(e.response?.data?.error || 'Erreur', 'error');
        } finally {
            setActionLoading(null);
        }
    };

    // ---- RENDER HELPERS ----
    const getDayKey = (date: Date) => {
        const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        return keys[date.getDay()];
    };

    const isMemberOnSlot = (slot: any) => {
        if (!user?.id) return false;
        return slot.members?.some((m: any) => m.memberId === user.id || m.member?.id === user.id);
    };

    const getSlotColor = (slot: any) => {
        return STATUS_COLORS[slot.status] || STATUS_COLORS.open;
    };

    // ---- CANDIDATE SUMMARY ----
    const candidateEnrolledCount = isCandidate ? slots.filter((s: any) => s.isEnrolled).length : 0;
    const candidateAvailableCount = isCandidate ? slots.filter((s: any) => !s.isFull && !s.isEnrolled).length : 0;

    if (loading) {
        return <div className="flex h-96 items-center justify-center"><Loader2 className="animate-spin text-gray-400" size={32} /></div>;
    }

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] gap-4">
            {/* ===== HEADER ===== */}
            <div className="flex items-center justify-between shrink-0">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Planning</h1>
                    <p className="text-sm text-gray-500">
                        {isAdmin && 'G\u00e9rez les cr\u00e9neaux d\u2019\u00e9valuation'}
                        {isMember && 'Indiquez vos disponibilit\u00e9s sur les cr\u00e9neaux ouverts'}
                        {isCandidate && 'Inscrivez-vous aux cr\u00e9neaux disponibles'}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                        <Button variant="ghost" size="sm" onClick={() => setWeekOffset(weekOffset - 1)}>
                            <ChevronLeft size={16} />
                        </Button>
                        <span className="text-sm font-medium w-44 text-center">
                            {format(currentWeekStart, 'd MMM', { locale: fr })} - {format(addDays(currentWeekStart, 5), 'd MMM yyyy', { locale: fr })}
                        </span>
                        <Button variant="ghost" size="sm" onClick={() => setWeekOffset(weekOffset + 1)}>
                            <ChevronRight size={16} />
                        </Button>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)}>
                        Aujourd&apos;hui
                    </Button>
                </div>
            </div>

            {/* ===== CANDIDATE SUMMARY ===== */}
            {isCandidate && (
                <div className="flex gap-4 shrink-0">
                    <div className="flex-1 flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
                        <Calendar size={18} className="text-blue-600" />
                        <div>
                            <p className="text-xs font-bold text-blue-600 uppercase">Cr&eacute;neaux disponibles</p>
                            <p className="text-lg font-black text-gray-800">{candidateAvailableCount}</p>
                        </div>
                    </div>
                    <div className="flex-1 flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-xl">
                        <Check size={18} className="text-green-600" />
                        <div>
                            <p className="text-xs font-bold text-green-600 uppercase">Mes inscriptions</p>
                            <p className="text-lg font-black text-gray-800">{candidateEnrolledCount}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* ===== LEGEND ===== */}
            {(isAdmin || isMember) && (
                <div className="flex gap-2 flex-wrap shrink-0 text-xs">
                    {Object.entries(STATUS_LABELS).map(([key, label]) => (
                        <div key={key} className={cn("flex items-center gap-1.5 px-2 py-1 rounded-full border", STATUS_COLORS[key]?.bg, STATUS_COLORS[key]?.border, STATUS_COLORS[key]?.text)}>
                            <span>{STATUS_EMOJI[key]}</span>
                            <span className="font-medium">{label}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* ===== WEEKLY GRID ===== */}
            <Card className="flex-1 flex flex-col overflow-hidden">
                <CardContent className="flex-1 p-0 overflow-auto flex">
                    {days.map(day => {
                        const dateStr = format(day, 'yyyy-MM-dd');
                        const dayKey = getDayKey(day);
                        const dayConfig = weeklySchedule?.[dayKey] || { start: dayStart, end: dayEnd, isOpen: true };
                        const isSaturday = day.getDay() === 6;

                        // Saturday: only morning (7-13h)
                        const effectiveEnd = isSaturday ? Math.min(dayConfig.end, 13) : dayConfig.end;
                        const totalHours = effectiveEnd - dayStart;
                        const totalMinutes = totalHours * 60;
                        const numberOfTimeSlots = Math.floor(totalMinutes / slotDuration);

                        // Filter slots for this day
                        const daySlots = slots.filter((s: any) => {
                            const slotDate = format(new Date(s.date), 'yyyy-MM-dd');
                            return slotDate === dateStr;
                        });

                        const isSunday = day.getDay() === 0;
                        const isDayClosed = !dayConfig.isOpen || isSunday || (isSaturday && !dayConfig.isOpen);

                        return (
                            <div key={dateStr} className="flex-1 min-w-[200px] border-r border-gray-100 last:border-r-0 flex flex-col">
                                {/* Day header */}
                                <div className="text-center p-3 border-b border-gray-100 bg-white sticky top-0 z-10">
                                    <div className="text-sm font-medium text-gray-500 uppercase">{format(day, 'EEEE', { locale: fr })}</div>
                                    <div className="text-2xl font-bold text-gray-900">{format(day, 'd')}</div>
                                </div>

                                {/* Time grid */}
                                <div
                                    className={cn(
                                        "relative flex-1 transition-colors",
                                        isDayClosed ? "bg-gray-100 cursor-not-allowed" : (isAdmin ? "bg-white cursor-pointer hover:bg-gray-50/50" : "bg-white")
                                    )}
                                    style={{ height: totalHours * HOUR_HEIGHT }}
                                    onClick={(e) => {
                                        if (!isAdmin || isDayClosed) return;
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        const y = e.clientY - rect.top;
                                        const minutesFromStart = (y / HOUR_HEIGHT) * 60;
                                        const slotIndex = Math.floor(minutesFromStart / slotDuration);
                                        const quantizedMinutes = slotIndex * slotDuration;
                                        const hour = dayStart + Math.floor(quantizedMinutes / 60);
                                        const minute = quantizedMinutes % 60;
                                        if (hour >= dayStart && hour < effectiveEnd) {
                                            handleGridClick(day, hour, minute);
                                        }
                                    }}
                                >
                                    {isDayClosed && (
                                        <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm font-medium uppercase tracking-widest">Ferm&eacute;</div>
                                    )}

                                    {/* Grid lines */}
                                    {!isDayClosed && Array.from({ length: numberOfTimeSlots }).map((_, i) => {
                                        const slotTimeMinutes = i * slotDuration;
                                        const top = (slotTimeMinutes / 60) * HOUR_HEIGHT;
                                        const absoluteMinutes = (dayStart * 60) + slotTimeMinutes;
                                        const h = Math.floor(absoluteMinutes / 60);
                                        const m = absoluteMinutes % 60;
                                        const isFullHour = m === 0;

                                        return (
                                            <div
                                                key={i}
                                                className={cn("absolute w-full text-xs text-gray-300 pl-1 pointer-events-none flex items-center",
                                                    isFullHour ? "border-b-2 border-gray-100" : "border-b border-dashed border-gray-50"
                                                )}
                                                style={{ top, height: (slotDuration / 60) * HOUR_HEIGHT }}
                                            >
                                                {isFullHour && <span className="-mt-[20px]">{h}:00</span>}
                                            </div>
                                        );
                                    })}

                                    {/* Slot blocks */}
                                    {!isDayClosed && daySlots.map((slot: any) => {
                                        const [sh, sm] = slot.startTime.split(':').map(Number);
                                        const [eh, em] = (slot.endTime || slot.startTime).split(':').map(Number);
                                        const startMinutes = (sh - dayStart) * 60 + sm;
                                        const durationMins = (eh * 60 + em) - (sh * 60 + sm);
                                        const top = (startMinutes / 60) * HOUR_HEIGHT;
                                        const height = Math.max((durationMins / 60) * HOUR_HEIGHT, 30);
                                        const color = getSlotColor(slot);
                                        const memberCount = slot.members?.length || 0;
                                        const enrollCount = slot.enrollments?.length || slot.enrolledCount || 0;
                                        const isMySlot = isMemberOnSlot(slot);
                                        const hasRequests = (slot.requests?.length || 0) > 0;

                                        return (
                                            <div
                                                key={slot.id}
                                                className={cn(
                                                    "absolute left-1 right-1 rounded-lg border-l-4 px-2 py-1 text-[11px] overflow-hidden z-20 transition-all",
                                                    "hover:shadow-md hover:brightness-95 cursor-pointer",
                                                    color.bg, color.border, color.text,
                                                    isMySlot && "ring-2 ring-blue-400"
                                                )}
                                                style={{ top: `${top}px`, height: `${height}px` }}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (isAdmin) {
                                                        handleEditSlot(slot);
                                                    } else if (isMember) {
                                                        handleToggleMember(slot.id);
                                                    } else if (isCandidate) {
                                                        if (slot.isEnrolled) {
                                                            handleCancelEnroll(slot.id);
                                                        } else if (!slot.isFull) {
                                                            handleEnroll(slot.id);
                                                        }
                                                    }
                                                }}
                                            >
                                                {/* Label */}
                                                <div className="font-bold truncate">
                                                    {slot.label || slot.epreuve?.name || `${slot.startTime}-${slot.endTime}`}
                                                </div>

                                                {/* Time */}
                                                <div className="opacity-70">{slot.startTime} - {slot.endTime}</div>

                                                {/* Admin: Members + Candidates count */}
                                                {isAdmin && (
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                        <span className="flex items-center gap-0.5">
                                                            <Users size={10} /> {memberCount}/{slot.minMembers}
                                                        </span>
                                                        <span className="flex items-center gap-0.5">
                                                            <Check size={10} /> {enrollCount}/{slot.maxCandidates}
                                                        </span>
                                                        {hasRequests && (
                                                            <span title="Demandes de dispo re\u00e7ues">
                                                                <Mail size={10} className="text-amber-500" />
                                                            </span>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Member: show if I'm on it */}
                                                {isMember && (
                                                    <div className="mt-0.5">
                                                        {isMySlot ? (
                                                            <span className="flex items-center gap-0.5 font-bold text-green-700">
                                                                <Check size={10} /> Disponible
                                                            </span>
                                                        ) : (
                                                            <span className="flex items-center gap-0.5 text-gray-400">
                                                                Cliquer pour signaler dispo
                                                            </span>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Candidate: enrollment info */}
                                                {isCandidate && (
                                                    <div className="mt-0.5">
                                                        {slot.isEnrolled ? (
                                                            <span className="flex items-center gap-0.5 font-bold text-green-700">
                                                                <Check size={10} /> Inscrit(e)
                                                            </span>
                                                        ) : slot.isFull ? (
                                                            <span className="text-red-500 font-bold">Complet</span>
                                                        ) : (
                                                            <span className="flex items-center gap-0.5">
                                                                <Users size={10} /> {slot.maxCandidates - enrollCount} place{(slot.maxCandidates - enrollCount) > 1 ? 's' : ''}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Admin quick action loading */}
                                                {actionLoading === slot.id && (
                                                    <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-lg">
                                                        <Loader2 className="animate-spin" size={16} />
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </CardContent>
            </Card>

            {/* ===== ADMIN: SLOT LIST BELOW GRID ===== */}
            {isAdmin && slots.length > 0 && (
                <Card className="shrink-0 max-h-64 overflow-auto">
                    <CardContent className="p-0">
                        <table className="w-full text-xs text-left">
                            <thead className="bg-gray-50 border-b sticky top-0">
                                <tr>
                                    <th className="px-3 py-2">Cr&eacute;neau</th>
                                    <th className="px-3 py-2">Date</th>
                                    <th className="px-3 py-2">Horaire</th>
                                    <th className="px-3 py-2">Salle</th>
                                    <th className="px-3 py-2">&Eacute;valuateurs</th>
                                    <th className="px-3 py-2">Candidats</th>
                                    <th className="px-3 py-2">Statut</th>
                                    <th className="px-3 py-2 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {slots.map((slot: any) => {
                                    const color = getSlotColor(slot);
                                    const memberCount = slot.members?.length || 0;
                                    const enrollCount = slot.enrollments?.length || 0;

                                    return (
                                        <tr key={slot.id} className="hover:bg-gray-50">
                                            <td className="px-3 py-2 font-medium">{slot.label || slot.epreuve?.name || '-'}</td>
                                            <td className="px-3 py-2">{format(new Date(slot.date), 'dd/MM/yyyy')}</td>
                                            <td className="px-3 py-2">{slot.startTime} - {slot.endTime}</td>
                                            <td className="px-3 py-2">{slot.room || '-'}</td>
                                            <td className="px-3 py-2">
                                                <span className={cn("font-bold", memberCount >= slot.minMembers ? "text-green-600" : "text-orange-500")}>
                                                    {memberCount}
                                                </span>
                                                <span className="text-gray-400">/{slot.minMembers} min</span>
                                                {slot.members?.length > 0 && (
                                                    <div className="flex flex-wrap gap-0.5 mt-0.5">
                                                        {slot.members.map((m: any) => (
                                                            <span key={m.id} className="bg-blue-50 text-blue-600 px-1 rounded text-[9px]">
                                                                {m.member?.email?.split('@')[0]}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-3 py-2">
                                                <span className="font-bold">{enrollCount}</span>
                                                <span className="text-gray-400">/{slot.maxCandidates}</span>
                                                {slot.enrollments?.length > 0 && (
                                                    <div className="text-[9px] text-gray-500 mt-0.5">
                                                        {slot.enrollments.map((e: any) => `${e.candidate?.firstName} ${e.candidate?.lastName}`).join(', ')}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-3 py-2">
                                                <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold border", color.bg, color.border, color.text)}>
                                                    {STATUS_EMOJI[slot.status]} {STATUS_LABELS[slot.status]}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-right">
                                                <div className="flex gap-1 justify-end">
                                                    {slot.status === 'open' && (
                                                        <Button size="sm" variant="ghost" className="text-green-600 h-6 px-1.5 text-[10px]"
                                                            onClick={() => handleStatusChange(slot.id, 'published')}
                                                            disabled={actionLoading === slot.id}>
                                                            <Unlock size={12} className="mr-0.5" /> Ouvrir
                                                        </Button>
                                                    )}
                                                    {slot.status === 'ready' && (
                                                        <Button size="sm" variant="ghost" className="text-green-600 h-6 px-1.5 text-[10px]"
                                                            onClick={() => handleStatusChange(slot.id, 'published')}
                                                            disabled={actionLoading === slot.id}>
                                                            <Unlock size={12} className="mr-0.5" /> Ouvrir candidats
                                                        </Button>
                                                    )}
                                                    {slot.status === 'published' && (
                                                        <Button size="sm" variant="ghost" className="text-orange-600 h-6 px-1.5 text-[10px]"
                                                            onClick={() => handleStatusChange(slot.id, 'closed')}
                                                            disabled={actionLoading === slot.id}>
                                                            <Lock size={12} className="mr-0.5" /> Fermer
                                                        </Button>
                                                    )}
                                                    <Button size="sm" variant="ghost" className="text-red-500 h-6 px-1.5"
                                                        onClick={() => handleDeleteSlot(slot.id)}
                                                        disabled={actionLoading === slot.id}>
                                                        <Trash2 size={12} />
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </CardContent>
                </Card>
            )}

            {/* ===== MEMBER: ASSIGNED SLOTS LIST ===== */}
            {isMember && (
                <Card className="shrink-0">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Mes cr&eacute;neaux assign&eacute;s</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {slots.filter((s: any) => isMemberOnSlot(s)).length === 0 ? (
                            <p className="text-xs text-gray-400 italic">Aucun cr&eacute;neau — cliquez sur un cr&eacute;neau bleu pour signaler votre disponibilit&eacute;.</p>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {slots.filter((s: any) => isMemberOnSlot(s)).map((slot: any) => (
                                    <div key={slot.id} className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs">
                                        <div className="font-bold text-blue-800">{slot.label || slot.epreuve?.name || 'Cr\u00e9neau'}</div>
                                        <div className="text-blue-600">{format(new Date(slot.date), 'd MMM', { locale: fr })} &middot; {slot.startTime}-{slot.endTime}</div>
                                        {slot.enrollments?.length > 0 && (
                                            <div className="text-gray-500 mt-0.5">
                                                {slot.enrollments.map((e: any) => `${e.candidate?.firstName} ${e.candidate?.lastName}`).join(', ')}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* ===== ADMIN: CREATE/EDIT MODAL ===== */}
            {showModal && isAdmin && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
                    <Card className="w-full max-w-md" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                        <CardHeader>
                            <CardTitle>{editingSlot ? 'Modifier le cr\u00e9neau' : 'Nouveau cr\u00e9neau'}</CardTitle>
                            <p className="text-sm text-gray-500">{selectedDate && format(new Date(selectedDate + 'T12:00:00'), 'EEEE d MMMM yyyy', { locale: fr })}</p>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>Heure de d&eacute;but</Label>
                                    <Input type="time" value={formData.startTime} onChange={e => setFormData({ ...formData, startTime: e.target.value })} />
                                </div>
                                <div>
                                    <Label>Dur&eacute;e</Label>
                                    <select
                                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                        value={formData.duration}
                                        onChange={e => setFormData({ ...formData, duration: parseInt(e.target.value) })}
                                    >
                                        <option value={15}>15 min</option>
                                        <option value={30}>30 min</option>
                                        <option value={45}>45 min</option>
                                        <option value={60}>1h</option>
                                        <option value={90}>1h30</option>
                                        <option value={120}>2h</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>Cr&eacute;neaux simultan&eacute;s</Label>
                                    <Input type="number" min={0} max={5} value={formData.simultaneousSlots}
                                        onChange={e => setFormData({ ...formData, simultaneousSlots: parseInt(e.target.value) || 0 })} />
                                    <p className="text-[10px] text-gray-400 mt-0.5">0 = d&eacute;sactiv&eacute;</p>
                                </div>
                                <div>
                                    <Label>&Eacute;valuateurs minimum</Label>
                                    <Input type="number" min={1} value={formData.minMembers}
                                        onChange={e => setFormData({ ...formData, minMembers: parseInt(e.target.value) || 1 })} />
                                    <p className="text-[10px] text-gray-400 mt-0.5">Pour visibilit&eacute; candidats</p>
                                </div>
                            </div>

                            <div>
                                <Label>Candidats max par cr&eacute;neau</Label>
                                <Input type="number" min={1} max={6} value={formData.maxCandidates}
                                    onChange={e => setFormData({ ...formData, maxCandidates: parseInt(e.target.value) || 1 })} />
                                <p className="text-[10px] text-gray-400 mt-0.5">1 = individuel, 2-6 = groupe</p>
                            </div>

                            <div>
                                <Label>Label / Titre (optionnel)</Label>
                                <Input value={formData.label} onChange={e => setFormData({ ...formData, label: e.target.value })}
                                    placeholder="Ex: Jury A, Oral B2..." />
                            </div>

                            <div>
                                <Label>Salle (optionnel)</Label>
                                <Input value={formData.room} onChange={e => setFormData({ ...formData, room: e.target.value })}
                                    placeholder="Ex: Salle 201" />
                            </div>

                            <div className="flex justify-between pt-2">
                                <div>
                                    {editingSlot && (
                                        <Button variant="ghost" className="text-red-600 hover:bg-red-50"
                                            onClick={() => { setShowModal(false); handleDeleteSlot(editingSlot.id); }}>
                                            <Trash2 size={14} className="mr-1" /> Supprimer
                                        </Button>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <Button variant="ghost" onClick={() => setShowModal(false)}>Annuler</Button>
                                    <Button onClick={handleSaveSlot} disabled={actionLoading === 'save'} className="bg-black text-white hover:bg-gray-800">
                                        {actionLoading === 'save' ? <Loader2 className="animate-spin mr-1" size={14} /> : <Save size={14} className="mr-1" />}
                                        {editingSlot ? 'Modifier' : 'Cr\u00e9er'}
                                    </Button>
                                </div>
                            </div>

                            {/* Admin: Status change for existing slot */}
                            {editingSlot && (
                                <div className="border-t pt-3 mt-2">
                                    <Label className="text-xs text-gray-500 uppercase">Changer le statut</Label>
                                    <div className="flex gap-1 mt-1 flex-wrap">
                                        {['open', 'ready', 'published', 'closed', 'cancelled'].map(s => (
                                            <Button
                                                key={s}
                                                size="sm"
                                                variant={editingSlot.status === s ? 'default' : 'outline'}
                                                className={cn("text-xs h-7", editingSlot.status === s && "bg-gray-800 text-white")}
                                                onClick={() => { handleStatusChange(editingSlot.id, s); setShowModal(false); }}
                                            >
                                                {STATUS_EMOJI[s]} {STATUS_LABELS[s]}
                                            </Button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
