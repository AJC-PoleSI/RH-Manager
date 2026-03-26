"use client";

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { CalendarColumn } from '@/components/calendar/CalendarColumn';
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
    const fetchKPIs = async () => {
        try {
            const res = await api.get('/kpis/global');
            setKpis(res.data);
        } catch (e) {
            console.error(e);
        }
    };

    const fetchEpreuves = async () => {
        try {
            const res = await api.get('/epreuves');
            setEpreuves(res.data);
        } catch (e) {
            console.error(e);
        }
    };

    const fetchEvents = async () => {
        try {
            const start = daysToShow[0].toISOString();
            const end = daysToShow[4].toISOString();
            const res = await api.get('/calendar', { params: { start, end } });

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

            const slotEvents = mySlots.map((slot: any) => ({
                id: `slot-${slot.id}`,
                title: `${slot.epreuve?.name || 'Evaluation'}`,
                description: slot.enrollments?.map((e: any) => `${e.candidate?.firstName} ${e.candidate?.lastName}`).join(', ') || '',
                day: slot.date,
                startTime: slot.startTime,
                endTime: slot.endTime,
                isSlot: true,
                room: slot.room
            }));

            setEvents([...res.data, ...deadlineEvents, ...slotEvents]);
        } catch (e) {
            console.error(e);
        }
    };

    const fetchDeadlines = async () => {
        try {
            const res = await api.get('/settings');
            setDeadlines({
                deadline_candidats: res.data.deadline_candidats,
                deadline_membres: res.data.deadline_membres
            });
        } catch (e) {
            console.error(e);
        }
    };

    const fetchMySlots = async () => {
        try {
            const res = await api.get('/slots/my-slots');
            setMySlots(res.data);
        } catch (e) {
            console.error(e);
        }
    };

    // ── Effects ───────────────────────────────
    useEffect(() => {
        fetchKPIs();
        if (isAdmin) {
            fetchEpreuves();
        }
    }, [role, user]);

    useEffect(() => {
        if (!isAdmin) {
            fetchEvents();
            fetchDeadlines();
            fetchMySlots();
        }
    }, [role, user, currentDate]);

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
        if (!isAdmin) return;
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
        const statCards = [
            { label: 'Candidats actifs', value: kpis?.totalCandidates ?? '—', color: '#2563EB', bg: '#EFF6FF' },
            { label: 'Membres JE', value: kpis?.totalMembers ?? '—', color: '#E8446A', bg: '#FFF0F3' },
            { label: 'Tours créés', value: 3, color: '#16A34A', bg: '#DCFCE7' },
            { label: 'Épreuves', value: kpis?.totalEpreuves ?? epreuves.length ?? '—', color: '#6B7280', bg: '#F3F4F6' },
        ];

        const tours = [
            { label: 'Tour 1', status: 'done' as const },
            { label: 'Tour 2', status: 'active' as const },
            { label: 'Tour 3', status: 'upcoming' as const },
        ];

        const tourColors = {
            done: { bar: 'bg-green-500', dot: 'bg-green-500 ring-green-200', text: 'text-green-700' },
            active: { bar: 'bg-blue-500', dot: 'bg-blue-500 ring-blue-200', text: 'text-blue-700' },
            upcoming: { bar: 'bg-gray-200', dot: 'bg-gray-300 ring-gray-100', text: 'text-gray-400' },
        };

        const totalCandidates = kpis?.totalCandidates ?? 1;
        const enCours = kpis?.enCours ?? Math.round(totalCandidates * 0.6);
        const elimines = kpis?.elimines ?? Math.round(totalCandidates * 0.25);
        const abandons = kpis?.abandons ?? Math.round(totalCandidates * 0.15);

        const quickLinks = [
            { label: 'Gestion candidats', href: '/dashboard/candidates' },
            { label: 'Épreuves', href: '/dashboard/epreuves' },
            { label: 'Soirée débat', href: '/dashboard/deliberations' },
            { label: 'Paramètres', href: '/dashboard/settings' },
        ];

        return (
            <div className="space-y-6 max-w-[1100px] mx-auto">
                {/* Header */}
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
                    <p className="text-sm text-gray-500 mt-1">Vue d&apos;ensemble du recrutement AJC 2025</p>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-4 gap-4">
                    {statCards.map((card) => (
                        <div
                            key={card.label}
                            className="bg-white border border-gray-200 rounded-[10px]"
                            style={{ padding: '15px 18px' }}
                        >
                            <div className="flex items-center gap-2 mb-2">
                                <div
                                    className="w-2.5 h-2.5 rounded-full"
                                    style={{ backgroundColor: card.color }}
                                />
                                <span className="text-xs text-gray-500">{card.label}</span>
                            </div>
                            <div
                                className="text-2xl font-extrabold"
                                style={{ color: card.color }}
                            >
                                {card.value}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Tour progress */}
                <div className="bg-white border border-gray-200 rounded-[10px] p-5">
                    <h2 className="text-sm font-semibold text-gray-700 mb-4">Progression des tours</h2>
                    <div className="flex items-center gap-0">
                        {tours.map((tour, idx) => {
                            const c = tourColors[tour.status];
                            return (
                                <div key={tour.label} className="flex items-center flex-1">
                                    {/* Bar segment */}
                                    <div className="flex-1 relative">
                                        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                                            <div className={`h-full rounded-full ${c.bar}`} style={{ width: tour.status === 'upcoming' ? '0%' : '100%' }} />
                                        </div>
                                    </div>
                                    {/* Dot + label */}
                                    <div className="flex flex-col items-center mx-2 -mt-1">
                                        <div className={`w-4 h-4 rounded-full ring-4 ${c.dot}`} />
                                        <span className={`text-xs font-semibold mt-1 ${c.text}`}>{tour.label}</span>
                                    </div>
                                    {/* Trailing bar for last item */}
                                    {idx === tours.length - 1 && (
                                        <div className="flex-1">
                                            <div className="h-2 rounded-full bg-gray-100" />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Two-column grid */}
                <div className="grid grid-cols-2 gap-4">
                    {/* Upcoming epreuves */}
                    <div className="bg-white border border-gray-200 rounded-[10px] p-5">
                        <h2 className="text-sm font-semibold text-gray-700 mb-4">Prochaines épreuves</h2>
                        {epreuves.length === 0 ? (
                            <p className="text-sm text-gray-400">Aucune épreuve trouvée</p>
                        ) : (
                            <div className="space-y-3">
                                {epreuves.slice(0, 5).map((ep) => (
                                    <div
                                        key={ep.id}
                                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100"
                                    >
                                        <div>
                                            <p className="text-sm font-medium text-gray-800">{ep.name}</p>
                                            {ep.type && (
                                                <p className="text-xs text-gray-400 mt-0.5">{ep.type}</p>
                                            )}
                                        </div>
                                        <div className="text-right">
                                            {ep.tour && (
                                                <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                                                    Tour {ep.tour}
                                                </span>
                                            )}
                                            {ep.date && (
                                                <p className="text-xs text-gray-400 mt-1">
                                                    {format(new Date(ep.date), 'd MMM yyyy', { locale: fr })}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Avancement */}
                    <div className="bg-white border border-gray-200 rounded-[10px] p-5">
                        <h2 className="text-sm font-semibold text-gray-700 mb-4">Avancement</h2>
                        <div className="space-y-5">
                            {[
                                { label: 'En cours', value: enCours, total: totalCandidates, color: 'bg-blue-500' },
                                { label: 'Éliminés', value: elimines, total: totalCandidates, color: 'bg-red-400' },
                                { label: 'Abandons', value: abandons, total: totalCandidates, color: 'bg-orange-400' },
                            ].map((item) => {
                                const pct = totalCandidates > 0 ? Math.round((item.value / item.total) * 100) : 0;
                                return (
                                    <div key={item.label}>
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-sm text-gray-600">{item.label}</span>
                                            <span className="text-sm font-semibold text-gray-800">{item.value} ({pct}%)</span>
                                        </div>
                                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full ${item.color} transition-all duration-500`}
                                                style={{ width: `${pct}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Quick access */}
                <div className="bg-white border border-gray-200 rounded-[10px] p-5">
                    <h2 className="text-sm font-semibold text-gray-700 mb-4">Accès rapides</h2>
                    <div className="flex flex-wrap gap-3">
                        {quickLinks.map((link) => (
                            <Link
                                key={link.href}
                                href={link.href}
                                className="px-4 py-2 text-sm font-medium bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg text-gray-700 transition-colors"
                            >
                                {link.label}
                            </Link>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // ──────────────────────────────────────────
    // MEMBER VIEW (calendar)
    // ──────────────────────────────────────────
    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] gap-4">
            {/* Calendar card */}
            <div className="flex-1 flex flex-col bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Week nav header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                    <h2 className="text-lg font-bold text-gray-900 capitalize">
                        {format(currentDate, 'MMMM yyyy', { locale: fr })}
                    </h2>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setCurrentDate(addDays(currentDate, -7))}
                            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                        >
                            <ChevronLeft size={20} />
                        </button>
                        <button
                            onClick={() => setCurrentDate(new Date())}
                            className="px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100 transition-colors"
                        >
                            Aujourd&apos;hui
                        </button>
                        <button
                            onClick={() => setCurrentDate(addDays(currentDate, 7))}
                            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                        >
                            <ChevronRight size={20} />
                        </button>
                        {isAdmin && (
                            <button
                                onClick={openCreateModal}
                                className="ml-4 px-3 py-1.5 bg-black text-white rounded-md text-sm font-medium hover:bg-gray-800 transition-colors"
                            >
                                + Événement
                            </button>
                        )}
                    </div>
                </div>

                {/* Calendar columns Mon-Fri */}
                <div className="flex-1 overflow-y-auto flex">
                    {daysToShow.map((day) => (
                        <CalendarColumn
                            key={day.toISOString()}
                            date={day}
                            events={events}
                            isMember={role === 'member'}
                            variant="simple-list"
                            onEventClick={openEditModal}
                        />
                    ))}
                </div>
            </div>

            {/* Event Modal */}
            {showEventModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
                    <div className="bg-white rounded-xl border border-gray-200 w-96 shadow-xl">
                        <div className="px-5 py-4 border-b border-gray-100">
                            <h3 className="text-base font-semibold text-gray-900">
                                {editingId ? 'Modifier l&apos;événement' : 'Nouvel événement'}
                            </h3>
                        </div>
                        <div className="p-5">
                            <form onSubmit={handleSaveEvent} className="space-y-4">
                                <div>
                                    <label className="text-sm text-gray-600 mb-1 block">Titre</label>
                                    <input
                                        className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                                        required
                                        value={eventFormData.title}
                                        onChange={(e) => setEventFormData({ ...eventFormData, title: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="text-sm text-gray-600 mb-1 block">Description</label>
                                    <input
                                        className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                                        value={eventFormData.description}
                                        onChange={(e) => setEventFormData({ ...eventFormData, description: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="text-sm text-gray-600 mb-1 block">Date</label>
                                    <input
                                        type="date"
                                        className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                                        required
                                        value={eventFormData.day}
                                        onChange={(e) => setEventFormData({ ...eventFormData, day: e.target.value })}
                                    />
                                </div>
                                <div className="flex gap-3">
                                    <div className="flex-1">
                                        <label className="text-sm text-gray-600 mb-1 block">Début</label>
                                        <input
                                            type="time"
                                            className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                                            required
                                            value={eventFormData.start_time}
                                            onChange={(e) => setEventFormData({ ...eventFormData, start_time: e.target.value })}
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <label className="text-sm text-gray-600 mb-1 block">Fin</label>
                                        <input
                                            type="time"
                                            className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                                            required
                                            value={eventFormData.end_time}
                                            onChange={(e) => setEventFormData({ ...eventFormData, end_time: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="flex justify-between gap-2 pt-3">
                                    <div>
                                        {editingId && (
                                            <button
                                                type="button"
                                                onClick={handleDeleteEvent}
                                                className="px-3 py-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg text-sm transition-colors"
                                            >
                                                Supprimer
                                            </button>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setShowEventModal(false)}
                                            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                        >
                                            Annuler
                                        </button>
                                        <button
                                            type="submit"
                                            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                                        >
                                            {editingId ? 'Mettre à jour' : 'Créer'}
                                        </button>
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
