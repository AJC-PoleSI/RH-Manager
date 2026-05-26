"use client";

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { CalendarColumn } from '@/components/calendar/CalendarColumn';
import MemberDashboardCalendar from '@/components/calendar/MemberDashboardCalendar';
import { format, addDays, startOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import Link from 'next/link';

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────
interface Kpis {
    totalCandidates: number;
    totalMembers: number;
    totalEpreuves?: number;
    enCours?: number;
    elimines?: number;
    abandons?: number;
}

interface Epreuve {
    id: string;
    name: string;
    tour?: number;
    date?: string;
    type?: string;
}

// ────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────
export default function DashboardPage() {
    const { toast } = useToast();
    const { user, role } = useAuth();
    const isAdmin = role === 'member' && user?.isAdmin;

    // Shared state
    const [kpis, setKpis] = useState<Kpis | null>(null);
    const [epreuves, setEpreuves] = useState<Epreuve[]>([]);

    // Member calendar state
    const [events, setEvents] = useState<any[]>([]);
    const [currentDate, setCurrentDate] = useState(new Date());
    const [deadlines, setDeadlines] = useState<{ deadline_candidats?: string; deadline_membres?: string }>({});
    const [mySlots, setMySlots] = useState<any[]>([]);
    const [showEventModal, setShowEventModal] = useState(false);
    const [selectedMemberSlot, setSelectedMemberSlot] = useState<any>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [eventFormData, setEventFormData] = useState({
        title: '',
        description: '',
        day: new Date().toISOString().split('T')[0],
        start_time: '09:00',
        end_time: '10:00'
    });

    const daysToShow = Array.from({ length: 5 }).map((_, i) =>
        addDays(startOfWeek(currentDate, { weekStartsOn: 1 }), i)
    );

    // ── Fetchers ──────────────────────────────
    const fetchKPIs = useCallback(async () => {
        try {
            const res = await api.get('/kpis/global', {
                headers: { 'Cache-Control': 'no-store, no-cache', 'Pragma': 'no-cache' },
                params: { _t: Date.now() }
            });
            setKpis(res.data);
        } catch (e) {
            console.error(e);
        }
    }, []);

    const fetchEpreuves = useCallback(async () => {
        try {
            const res = await api.get('/epreuves', {
                headers: { 'Cache-Control': 'no-store, no-cache', 'Pragma': 'no-cache' },
                params: { _t: Date.now() }
            });
            setEpreuves(res.data);
        } catch (e) {
            console.error(e);
        }
    }, []);

    const fetchEvents = useCallback(async () => {
        try {
            let params = {};
            if (isAdmin) {
                const start = daysToShow[0].toISOString();
                const end = daysToShow[4].toISOString();
                params = { start, end };
            } else {
                // Pour les membres, on récupère tout le mois
                const startMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
                const endMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
                params = { start: startMonth.toISOString(), end: endMonth.toISOString() };
            }
            const res = await api.get('/calendar', { params });

            const deadlineEvents: any[] = [];
            if (deadlines.deadline_candidats) {
                deadlineEvents.push({
                    id: 'deadline-candidats',
                    title: 'Deadline Candidats',
                    day: deadlines.deadline_candidats,
                    startTime: '08:00',
                    endTime: '08:30',
                    isDeadline: true
                });
            }
            if (deadlines.deadline_membres) {
                deadlineEvents.push({
                    id: 'deadline-membres',
                    title: 'Deadline Membres',
                    day: deadlines.deadline_membres,
                    startTime: '08:00',
                    endTime: '08:30',
                    isDeadline: true
                });
            }

            const slotEvents = mySlots.map((slot: any) => {
                const mappedEnrollments = slot.enrollments?.map((e: any) => ({
                    firstName: e.candidate?.firstName || e.candidate?.first_name || '',
                    lastName: e.candidate?.lastName || e.candidate?.last_name || '',
                })) || [];
                return {
                    id: `slot-${slot.id}`,
                    title: `${slot.epreuve?.name || 'Evaluation'}`,
                    description: mappedEnrollments.map((c: any) => `${c.firstName} ${c.lastName}`).join(', ') || '',
                    day: slot.date,
                    startTime: slot.startTime || slot.start_time,
                    endTime: slot.endTime || slot.end_time,
                    isSlot: true,
                    room: slot.room,
                    rawCandidates: mappedEnrollments
                };
            });

            // Normaliser snake_case → camelCase pour les events API
            const calendarEvents = (res.data || []).map((ev: any) => ({
                ...ev,
                startTime: ev.startTime || ev.start_time || "",
                endTime: ev.endTime || ev.end_time || "",
            }));

            setEvents([...calendarEvents, ...deadlineEvents, ...slotEvents]);
        } catch (e) {
            console.error(e);
        }
    }, [daysToShow, deadlines, mySlots, currentDate, isAdmin]);

    const fetchDeadlines = useCallback(async () => {
        try {
            const res = await api.get('/settings');
            setDeadlines({
                deadline_candidats: res.data.deadline_candidats,
                deadline_membres: res.data.deadline_membres
            });
        } catch (e) {
            console.error(e);
        }
    }, []);

    const fetchMySlots = useCallback(async () => {
        try {
            const res = await api.get('/slots/my-slots');
            setMySlots(res.data);
        } catch (e) {
            console.error(e);
        }
    }, []);

    // ── Effects ───────────────────────────────
    useEffect(() => {
        fetchKPIs();
        if (isAdmin) {
            fetchEpreuves();
        }
    }, [role, user, isAdmin, fetchKPIs, fetchEpreuves]);

    useEffect(() => {
        if (!isAdmin) {
            fetchEvents();
            fetchDeadlines();
            fetchMySlots();
        }
    }, [role, user, currentDate, isAdmin, fetchEvents, fetchDeadlines, fetchMySlots]);

    // ── Calendar event handlers ───────────────
    const openCreateModal = () => {
        setEditingId(null);
        setEventFormData({
            title: '',
            description: '',
            day: new Date().toISOString().split('T')[0],
            start_time: '09:00',
            end_time: '10:00'
        });
        setShowEventModal(true);
    };

    const openEditModal = (event: any) => {
        setEditingId(event.id);
        const eventDate = new Date(event.day);
        setEventFormData({
            title: event.title,
            description: event.description || '',
            day: !isNaN(eventDate.getTime()) ? eventDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
            start_time: event.startTime,
            end_time: event.endTime
        });
        setShowEventModal(true);
    };

    const handleEventClick = (event: any) => {
        if (isAdmin) {
            openEditModal(event);
        } else {
            if (event.isSlot) {
                setSelectedMemberSlot(event);
            }
        }
    };

    const handleSaveEvent = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const payload = {
                ...eventFormData,
                day: new Date(eventFormData.day)
            };
            if (editingId) {
                await api.put(`/calendar/${editingId}`, payload);
            } else {
                await api.post('/calendar', payload);
            }
            setShowEventModal(false);
            fetchEvents();
        } catch {
            try { toast('Erreur lors de la sauvegarde', 'error'); } catch {}
        }
    };

    const handleDeleteEvent = async () => {
        if (!editingId || !confirm('Supprimer cet événement ?')) return;
        try {
            await api.delete(`/calendar/${editingId}`);
            setShowEventModal(false);
            fetchEvents();
        } catch {
            try { toast('Erreur lors de la suppression', 'error'); } catch {}
        }
    };

    // ──────────────────────────────────────────
    // ADMIN VIEW
    // ──────────────────────────────────────────
    if (isAdmin) {
        const totalCandidates = kpis?.totalCandidates ?? 0;
        const totalMembers = kpis?.totalMembers ?? 0;
        const totalEpreuves = kpis?.totalEpreuves ?? epreuves.length ?? 0;
        const totalEvaluations = (kpis as any)?.totalEvaluations ?? 0;
        const totalSlots = (kpis as any)?.totalSlots ?? 0;
        const toursCreated = (kpis as any)?.toursCreated ?? 0;

        const enCours = kpis?.enCours ?? 0;
        const accepted = (kpis as any)?.accepted ?? 0;
        const refused = (kpis as any)?.refused ?? 0;
        const waiting = (kpis as any)?.waiting ?? 0;

        const pctAccepted = totalCandidates > 0 ? Math.round((accepted / totalCandidates) * 100) : 0;
        const pctRefused = totalCandidates > 0 ? Math.round((refused / totalCandidates) * 100) : 0;
        const pctWaiting = totalCandidates > 0 ? Math.round((waiting / totalCandidates) * 100) : 0;
        const pctEnCours = totalCandidates > 0 ? Math.round((enCours / totalCandidates) * 100) : 0;

        // Evaluation completion rate
        const evalCompletionPct = totalCandidates > 0 && totalEpreuves > 0
            ? Math.min(100, Math.round((totalEvaluations / (totalCandidates * totalEpreuves)) * 100))
            : 0;

        // Build progress ring SVG helper
        const ProgressRing = ({ pct, color, size = 80, stroke = 6 }: { pct: number; color: string; size?: number; stroke?: number }) => {
            const radius = (size - stroke) / 2;
            const circumference = 2 * Math.PI * radius;
            const offset = circumference - (pct / 100) * circumference;
            return (
                <svg width={size} height={size} className="transform -rotate-90">
                    <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#f3f4f6" strokeWidth={stroke} />
                    <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke}
                        strokeDasharray={circumference} strokeDashoffset={offset}
                        strokeLinecap="round" className="transition-all duration-1000 ease-out" />
                </svg>
            );
        };

        const quickLinks = [
            { label: '📋 Gestion candidats', href: '/dashboard/candidates', desc: 'Voir, modifier, évaluer' },
            { label: '📅 Planning & Épreuves', href: '/dashboard/planning', desc: 'Créer épreuves, créneaux, publier' },
            { label: '🗳️ Délibération', href: '/dashboard/deliberations', desc: 'Soirée de délibération' },
            { label: '⚙️ Paramètres', href: '/dashboard/settings', desc: 'Réglages du recrutement' },
        ];

        return (
            <div className="space-y-8 max-w-[1200px] mx-auto pb-10">
                {/* Header */}
                <div className="flex items-end justify-between">
                    <div>
                        <h1 className="text-3xl font-semibold text-gray-900 tracking-tight">Dashboard</h1>
                        <p className="text-sm text-gray-500 mt-1 font-medium">Vue d&apos;ensemble du recrutement AJC 2025</p>
                    </div>
                    <div className="text-xs text-gray-400 font-mono bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100">
                        Mis à jour en temps réel
                    </div>
                </div>

                {/* ── TOP KPI ROW ────────────────────────── */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                    {[
                        {
                            label: 'Candidats',
                            value: totalCandidates,
                            icon: '👤',
                            gradient: 'from-blue-500 to-blue-600',
                            lightGradient: 'from-blue-50 to-blue-100',
                            textColor: 'text-blue-700',
                        },
                        {
                            label: 'Membres JE',
                            value: totalMembers,
                            icon: '👥',
                            gradient: 'from-rose-500 to-pink-600',
                            lightGradient: 'from-rose-50 to-pink-100',
                            textColor: 'text-rose-700',
                        },
                        {
                            label: 'Tours créés',
                            value: toursCreated,
                            icon: '🏁',
                            gradient: 'from-emerald-500 to-green-600',
                            lightGradient: 'from-emerald-50 to-green-100',
                            textColor: 'text-emerald-700',
                        },
                        {
                            label: 'Épreuves',
                            value: totalEpreuves,
                            icon: '🎯',
                            gradient: 'from-violet-500 to-purple-600',
                            lightGradient: 'from-violet-50 to-purple-100',
                            textColor: 'text-violet-700',
                        },
                    ].map((card) => (
                        <div key={card.label} className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${card.lightGradient} border border-white/60 shadow-sm hover:shadow-md transition-all duration-300 group`}>
                            <div className="p-5">
                                <div className="flex items-center justify-between mb-3">
                                    <span className="text-2xl">{card.icon}</span>
                                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${card.gradient} flex items-center justify-center text-white text-sm font-semibold shadow-lg`}>
                                        {card.value}
                                    </div>
                                </div>
                                <p className={`text-sm font-bold ${card.textColor}`}>{card.label}</p>
                            </div>
                            <div className={`absolute -right-4 -bottom-4 w-24 h-24 rounded-full bg-gradient-to-br ${card.gradient} opacity-[0.07] group-hover:opacity-[0.12] transition-opacity`} />
                        </div>
                    ))}
                </div>

                {/* ── SECONDARY STATS ROW ────────────────── */}
                <div className="grid grid-cols-3 gap-5">
                    {[
                        { label: 'Évaluations réalisées', value: totalEvaluations, icon: '📝', color: 'text-amber-700', bg: 'bg-amber-50' },
                        { label: 'Créneaux planifiés', value: totalSlots, icon: '📆', color: 'text-cyan-700', bg: 'bg-cyan-50' },
                        { label: 'Taux d\'évaluation', value: `${evalCompletionPct}%`, icon: '📊', color: 'text-indigo-700', bg: 'bg-indigo-50' },
                    ].map((stat) => (
                        <div key={stat.label} className={`${stat.bg} rounded-xl border border-white/80 p-4 flex items-center gap-4 hover:shadow-sm transition-shadow`}>
                            <span className="text-2xl">{stat.icon}</span>
                            <div>
                                <p className={`text-2xl font-semibold ${stat.color}`}>{stat.value}</p>
                                <p className="text-xs text-gray-500 font-medium">{stat.label}</p>
                            </div>
                        </div>
                    ))}
                </div>

                {/* ── TWO-COLUMN SECTION ─────────────────── */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                    {/* Candidate Progression Donut */}
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                        <h1 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-5">Progression des candidats</h1>
                        <div className="flex items-center gap-8">
                            <div className="relative flex-shrink-0">
                                <ProgressRing pct={pctAccepted + pctRefused + pctWaiting} color="#6366f1" size={120} stroke={10} />
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                    <span className="text-2xl font-semibold text-gray-800">{totalCandidates}</span>
                                    <span className="text-[10px] text-gray-400 font-bold uppercase">Total</span>
                                </div>
                            </div>
                            <div className="flex-1 space-y-3">
                                {[
                                    { label: 'En cours', value: enCours, pct: pctEnCours, color: 'bg-blue-500', dot: 'bg-blue-500' },
                                    { label: 'Acceptés', value: accepted, pct: pctAccepted, color: 'bg-emerald-500', dot: 'bg-emerald-500' },
                                    { label: 'Refusés', value: refused, pct: pctRefused, color: 'bg-red-400', dot: 'bg-red-400' },
                                    { label: 'Sous réserve', value: waiting, pct: pctWaiting, color: 'bg-amber-400', dot: 'bg-amber-400' },
                                ].map((item) => (
                                    <div key={item.label}>
                                        <div className="flex items-center justify-between mb-1">
                                            <div className="flex items-center gap-2">
                                                <div className={`w-2.5 h-2.5 rounded-full ${item.dot}`} />
                                                <span className="text-xs font-semibold text-gray-600">{item.label}</span>
                                            </div>
                                            <span className="text-xs font-semibold text-gray-800">{item.value} <span className="text-gray-400 font-medium">({item.pct}%)</span></span>
                                        </div>
                                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                            <div className={`h-full rounded-full ${item.color} transition-all duration-700 ease-out`} style={{ width: `${item.pct}%` }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Upcoming epreuves */}
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                        <h1 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-5">Prochaines épreuves</h1>
                        {epreuves.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-48 text-gray-300">
                                <span className="text-4xl mb-3">📭</span>
                                <p className="text-sm font-semibold">Aucune épreuve configurée</p>
                                <Link href="/dashboard/planning" className="text-xs text-blue-500 underline mt-2 hover:text-blue-700">Créer une épreuve</Link>
                            </div>
                        ) : (
                            <div className="space-y-2.5 max-h-[280px] overflow-y-auto">
                                {epreuves.slice(0, 8).map((ep) => (
                                    <div key={ep.id} className="flex items-center justify-between p-3.5 bg-gray-50/80 rounded-xl border border-gray-100 hover:bg-gray-100/80 transition-colors group">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-100 to-purple-200 flex items-center justify-center text-purple-700 text-xs font-semibold">
                                                T{ep.tour}
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-gray-800">{ep.name}</p>
                                                {ep.type && <p className="text-[11px] text-gray-400 mt-0.5 capitalize">{ep.type}</p>}
                                            </div>
                                        </div>
                                        {ep.date && (
                                            <span className="text-[11px] text-gray-400 font-medium">
                                                {format(new Date(ep.date), 'd MMM', { locale: fr })}
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* ── TOUR PROGRESS TIMELINE ────────────── */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                    <h1 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-6">Progression des tours</h1>
                    <div className="flex items-center gap-0">
                        {Array.from({ length: Math.max(toursCreated, 3) }).map((_, idx) => {
                            const tourNum = idx + 1;
                            // A tour is "done" if all its epreuves exist, "active" if some exist, "upcoming" otherwise
                            const tourEpreuves = epreuves.filter(e => e.tour === tourNum);
                            const status = tourEpreuves.length > 0 ? (idx < toursCreated - 1 ? 'done' : 'active') : 'upcoming';
                            const colors = {
                                done: { bar: 'bg-emerald-500', dot: 'bg-emerald-500 ring-emerald-200 ring-4', text: 'text-emerald-700' },
                                active: { bar: 'bg-blue-500', dot: 'bg-blue-500 ring-blue-200 ring-4', text: 'text-blue-700' },
                                upcoming: { bar: 'bg-gray-200', dot: 'bg-gray-300 ring-gray-100 ring-4', text: 'text-gray-400' },
                            };
                            const c = colors[status];
                            return (
                                <div key={tourNum} className="flex items-center flex-1">
                                    <div className="flex-1 relative">
                                        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                                            <div className={`h-full rounded-full ${c.bar} transition-all duration-500`} style={{ width: status === 'upcoming' ? '0%' : '100%' }} />
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-center mx-3 -mt-1">
                                        <div className={`w-5 h-5 rounded-full ${c.dot} transition-all`} />
                                        <span className={`text-xs font-bold mt-1.5 ${c.text}`}>Tour {tourNum}</span>
                                        <span className="text-[10px] text-gray-400">{tourEpreuves.length} épr.</span>
                                    </div>
                                    {idx === Math.max(toursCreated, 3) - 1 && (
                                        <div className="flex-1"><div className="h-2 rounded-full bg-gray-100" /></div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* ── QUICK ACCESS ──────────────────────── */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                    <h1 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-5">Accès rapides</h1>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {quickLinks.map((link) => (
                            <Link
                                key={link.href}
                                href={link.href}
                                className="group p-4 rounded-xl bg-gray-50/80 border border-gray-100 hover:bg-gray-100/80 hover:border-gray-200 transition-all text-center"
                            >
                                <p className="text-sm font-bold text-gray-700 group-hover:text-gray-900 transition-colors">{link.label}</p>
                                <p className="text-[11px] text-gray-400 mt-1">{link.desc}</p>
                            </Link>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return <MemberDashboardCalendar mySlots={mySlots} events={events} deadlines={deadlines} user={user} currentDate={currentDate} setCurrentDate={setCurrentDate} />;
}
