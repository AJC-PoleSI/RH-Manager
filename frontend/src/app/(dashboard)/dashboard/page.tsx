"use client";

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { CalendarColumn } from '@/components/calendar/CalendarColumn';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { format, addDays, startOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, AlertTriangle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';

export default function DashboardPage() {
    const { toast } = useToast();
    const [deadlines, setDeadlines] = useState<{ deadline_candidats?: string; deadline_membres?: string }>({});
    const [showEventModal, setShowEventModal] = useState(false);
    // Initialize with a valid date string or object to avoid RangeError
    const [eventFormData, setEventFormData] = useState({
        title: '',
        description: '',
        day: new Date().toISOString().split('T')[0], // Store as string YYYY-MM-DD for input
        start_time: '09:00',
        end_time: '10:00'
    });
    const [editingId, setEditingId] = useState<string | null>(null);

    const { user, role } = useAuth();
    const [events, setEvents] = useState<any[]>([]);
    const [kpis, setKpis] = useState<any>(null);
    const [currentDate, setCurrentDate] = useState(new Date());
    const [mySlots, setMySlots] = useState<any[]>([]);

    const daysToShow = Array.from({ length: 5 }).map((_, i) => addDays(startOfWeek(currentDate, { weekStartsOn: 1 }), i));

    const fetchEvents = async () => {
        try {
            const start = daysToShow[0].toISOString();
            const end = daysToShow[4].toISOString();
            const res = await api.get('/calendar', { params: { start, end } });
            // Add deadline events to calendar
            const deadlineEvents: any[] = [];
            if (deadlines.deadline_candidats) {
                deadlineEvents.push({
                    id: 'deadline-candidats',
                    title: '⏰ Deadline Candidats',
                    day: deadlines.deadline_candidats,
                    startTime: '08:00',
                    endTime: '08:30',
                    isDeadline: true
                });
            }
            if (deadlines.deadline_membres) {
                deadlineEvents.push({
                    id: 'deadline-membres',
                    title: '⏰ Deadline Membres',
                    day: deadlines.deadline_membres,
                    startTime: '08:00',
                    endTime: '08:30',
                    isDeadline: true
                });
            }
            // Convert my assigned slots to calendar events
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

    const fetchKPIs = async () => {
        try {
            const res = await api.get('/kpis/global');
            setKpis(res.data);
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
        } catch (e) { console.error(e); }
    };

    const fetchMySlots = async () => {
        try {
            const res = await api.get('/slots/my-slots');
            setMySlots(res.data);
        } catch (e) { console.error(e); }
    };

    useEffect(() => {
        fetchEvents();
        fetchDeadlines();
        if (role === 'member') {
            fetchKPIs();
            fetchMySlots();
        }
    }, [role, currentDate]);

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
        if (role !== 'member' || !user?.isAdmin) return; // Only admin can edit
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
                day: new Date(eventFormData.day) // Convert back to Date object for backend
            };

            if (editingId) {
                await api.put(`/calendar/${editingId}`, payload);
            } else {
                await api.post('/calendar', payload);
            }
            setShowEventModal(false);
            fetchEvents();
        } catch (e) {
            toast('Erreur lors de la sauvegarde', 'error');
        }
    };

    const handleDeleteEvent = async () => {
        if (!editingId || !confirm('Êtes-vous sûr de vouloir supprimer cet événement ?')) return;
        try {
            await api.delete(`/calendar/${editingId}`);
            setShowEventModal(false);
            fetchEvents();
        } catch (e) {
            toast('Erreur lors de la suppression', 'error');
        }
    };

    // Deadline helpers
    const getDeadlineBanners = () => {
        const banners: { label: string; date: string; daysLeft: number; isExpired: boolean }[] = [];
        const now = new Date();
        now.setHours(0, 0, 0, 0);

        if (deadlines.deadline_candidats) {
            const d = new Date(deadlines.deadline_candidats);
            const diff = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            banners.push({ label: 'Inscription épreuves (Candidats)', date: deadlines.deadline_candidats, daysLeft: diff, isExpired: diff < 0 });
        }
        if (deadlines.deadline_membres) {
            const d = new Date(deadlines.deadline_membres);
            const diff = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            banners.push({ label: 'Saisie disponibilités (Membres)', date: deadlines.deadline_membres, daysLeft: diff, isExpired: diff < 0 });
        }
        return banners;
    };

    const deadlineBanners = getDeadlineBanners();

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] gap-4">
            {/* Deadline Banners */}
            {deadlineBanners.length > 0 && (
                <div className="flex gap-3 shrink-0">
                    {deadlineBanners.map((b, i) => (
                        <div
                            key={i}
                            className={cn(
                                "flex-1 flex items-center gap-3 px-4 py-3 rounded-lg border text-sm font-medium",
                                b.isExpired
                                    ? "bg-red-50 border-red-200 text-red-700"
                                    : b.daysLeft <= 3
                                        ? "bg-orange-50 border-orange-200 text-orange-700"
                                        : "bg-blue-50 border-blue-200 text-blue-700"
                            )}
                        >
                            {b.isExpired ? <AlertTriangle size={18} /> : <Clock size={18} />}
                            <span>{b.label}</span>
                            <span className="ml-auto font-bold">
                                {b.isExpired
                                    ? `Expirée depuis ${Math.abs(b.daysLeft)}j`
                                    : b.daysLeft === 0
                                        ? "Aujourd\u0027hui !"
                                        : `${b.daysLeft}j restant${b.daysLeft > 1 ? 's' : ''}`
                                }
                            </span>
                            <span className="text-xs opacity-70">({b.date})</span>
                        </div>
                    ))}
                </div>
            )}

            <div className="flex flex-1 gap-6 min-h-0">
                <div className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="flex items-center justify-between p-4 border-b border-gray-100">
                        <h2 className="text-lg font-bold text-gray-900 capitalize">
                            {format(currentDate, 'MMMM yyyy', { locale: fr })}
                        </h2>
                        <div className="flex gap-2">
                            <button onClick={() => setCurrentDate(addDays(currentDate, -7))} className="p-2 hover:bg-gray-100 rounded-full"><ChevronLeft size={20} /></button>
                            <button onClick={() => setCurrentDate(new Date())} className="px-3 py-1 text-xs font-medium bg-primary-50 text-primary-600 rounded-md">Aujourd&apos;hui</button>
                            <button onClick={() => setCurrentDate(addDays(currentDate, 7))} className="p-2 hover:bg-gray-100 rounded-full"><ChevronRight size={20} /></button>
                            {role === 'member' && user?.isAdmin && <button onClick={openCreateModal} className="ml-4 px-3 py-1 bg-black text-white rounded text-sm">+ Événement</button>}
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto flex">
                        {daysToShow.map(day => (
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

                {/* Right Sidebar */}
                <div className="w-80 flex flex-col gap-6 shrink-0">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-gray-500 uppercase">Tour Actuel</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex gap-2">
                                {['T1', 'T2', 'T3'].map(t => (
                                    <div key={t} className={cn("px-3 py-1 rounded-full text-xs font-bold", t === 'T1' ? "bg-primary-600 text-white" : "bg-gray-100 text-gray-400")}>
                                        {t}
                                    </div>
                                ))}
                            </div>
                            <div className="mt-4">
                                <p className="text-2xl font-bold text-gray-900">Tour 1</p>
                                <p className="text-sm text-gray-500">Sélection dossiers</p>
                            </div>
                        </CardContent>
                    </Card>

                    {role === 'member' && mySlots.length > 0 && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-gray-500 uppercase">Mon Planning</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {mySlots.slice(0, 5).map((slot: any) => (
                                    <div key={slot.id} className="p-2 bg-blue-50 rounded-lg border border-blue-100 text-xs">
                                        <div className="font-bold text-blue-800">{slot.epreuve?.name}</div>
                                        <div className="text-blue-600 mt-0.5">
                                            {format(new Date(slot.date), 'd MMM', { locale: fr })} &middot; {slot.startTime}-{slot.endTime}
                                        </div>
                                        {slot.room && <div className="text-blue-500">{slot.room}</div>}
                                        {slot.enrollments?.length > 0 && (
                                            <div className="mt-1 text-gray-500">
                                                {slot.enrollments.map((e: any) => `${e.candidate?.firstName} ${e.candidate?.lastName}`).join(', ')}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    )}

                    {role === 'member' && kpis && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-gray-500 uppercase">Statistiques</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-gray-600">Candidats</span>
                                    <span className="font-bold text-gray-900">{kpis.totalCandidates}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-gray-600">Membres</span>
                                    <span className="font-bold text-gray-900">{kpis.totalMembers}</span>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>

            {/* Event Modal */}
            {showEventModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
                    <Card className="w-96">
                        <CardHeader><CardTitle>{editingId ? 'Modifier l\'événement' : 'Nouvel Événement'}</CardTitle></CardHeader>
                        <CardContent>
                            <form onSubmit={handleSaveEvent} className="space-y-4">
                                <div><label className="text-sm">Titre</label><input className="w-full border rounded p-2" required value={eventFormData.title} onChange={e => setEventFormData({ ...eventFormData, title: e.target.value })} /></div>
                                <div><label className="text-sm">Description</label><input className="w-full border rounded p-2" value={eventFormData.description} onChange={e => setEventFormData({ ...eventFormData, description: e.target.value })} /></div>
                                <div>
                                    <label className="text-sm">Date</label>
                                    <input type="date" className="w-full border rounded p-2" required
                                        value={eventFormData.day}
                                        onChange={e => setEventFormData({ ...eventFormData, day: e.target.value })}
                                    />
                                </div>
                                <div className="flex gap-2">
                                    <div className="flex-1"><label className="text-sm">Début</label><input type="time" className="w-full border rounded p-2" required value={eventFormData.start_time} onChange={e => setEventFormData({ ...eventFormData, start_time: e.target.value })} /></div>
                                    <div className="flex-1"><label className="text-sm">Fin</label><input type="time" className="w-full border rounded p-2" required value={eventFormData.end_time} onChange={e => setEventFormData({ ...eventFormData, end_time: e.target.value })} /></div>
                                </div>
                                <div className="flex justify-between gap-2 pt-2">
                                    <div>
                                        {editingId && (
                                            <button type="button" onClick={handleDeleteEvent} className="px-3 py-2 bg-red-50 text-red-600 hover:bg-red-100 rounded text-sm">Supprimer</button>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        <button type="button" onClick={() => setShowEventModal(false)} className="px-3 py-2 text-sm">Annuler</button>
                                        <button type="submit" className="px-3 py-2 bg-black text-white rounded text-sm">{editingId ? 'Mettre à jour' : 'Créer'}</button>
                                    </div>
                                </div>
                            </form>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
