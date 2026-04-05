"use client";

import { useState, useEffect, useMemo, useCallback } from 'react';
import api from '@/lib/api';
import { useSettings } from '@/context/SettingsContext';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { startOfWeek, addDays, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Loader2, ChevronLeft, ChevronRight, Users, Calendar, Check, AlertTriangle, Eye, Lock, Unlock, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';

const HOUR_HEIGHT = 60;

const MEMBER_COLORS = [
    { bg: 'bg-blue-100', border: 'border-blue-400', text: 'text-blue-800', dot: 'bg-blue-500' },
    { bg: 'bg-green-100', border: 'border-green-400', text: 'text-green-800', dot: 'bg-green-500' },
    { bg: 'bg-purple-100', border: 'border-purple-400', text: 'text-purple-800', dot: 'bg-purple-500' },
    { bg: 'bg-orange-100', border: 'border-orange-400', text: 'text-orange-800', dot: 'bg-orange-500' },
    { bg: 'bg-pink-100', border: 'border-pink-400', text: 'text-pink-800', dot: 'bg-pink-500' },
    { bg: 'bg-teal-100', border: 'border-teal-400', text: 'text-teal-800', dot: 'bg-teal-500' },
    { bg: 'bg-yellow-100', border: 'border-yellow-400', text: 'text-yellow-800', dot: 'bg-yellow-500' },
    { bg: 'bg-red-100', border: 'border-red-400', text: 'text-red-800', dot: 'bg-red-500' },
];

const getDayKey = (date: Date) => {
    const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    return keys[date.getDay()];
};

type TabType = 'availabilities' | 'generate' | 'slots';

export default function CrossCalendarPage() {
    const { settings } = useSettings();
    const { dayStart, dayEnd, slotDuration, weeklySchedule } = settings;
    const { toast } = useToast();

    const [activeTab, setActiveTab] = useState<TabType>('availabilities');
    const [loading, setLoading] = useState(true);

    // Availability view
    const [availabilities, setAvailabilities] = useState<any[]>([]);
    const [weekOffset, setWeekOffset] = useState(0);

    // Generate view
    const [epreuves, setEpreuves] = useState<any[]>([]);
    const [selectedEpreuve, setSelectedEpreuve] = useState('');
    const [membersPerSlot, setMembersPerSlot] = useState(2);
    const [maxCandidates, setMaxCandidates] = useState(1);
    const [generating, setGenerating] = useState(false);
    const [generatedResult, setGeneratedResult] = useState<any>(null);
    const [publishing, setPublishing] = useState(false);

    // Slots management
    const [existingSlots, setExistingSlots] = useState<any[]>([]);
    const [slotsLoading, setSlotsLoading] = useState(false);
    const [filterTour, setFilterTour] = useState<string>('');

    const currentWeekStart = useMemo(() => {
        const start = startOfWeek(new Date(), { weekStartsOn: 1 });
        return addDays(start, weekOffset * 7);
    }, [weekOffset]);

    const days = useMemo(() => Array.from({ length: 5 }).map((_, i) => addDays(currentWeekStart, i)), [currentWeekStart]);

    const fetchAvailabilities = useCallback(async () => {
        setLoading(true);
        try {
            const startStr = format(currentWeekStart, 'yyyy-MM-dd');
            const endStr = format(addDays(currentWeekStart, 6), 'yyyy-MM-dd');
            const res = await api.get('/availability/all', { params: { start: startStr, end: endStr } });
            setAvailabilities(res.data);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }, [currentWeekStart]);

    const fetchEpreuves = useCallback(async () => {
        try {
            const res = await api.get('/epreuves');
            setEpreuves(res.data);
        } catch (e) { console.error(e); }
    }, []);

    const fetchExistingSlots = useCallback(async () => {
        setSlotsLoading(true);
        try {
            const params: any = {};
            if (filterTour) params.tour = filterTour;
            const res = await api.get('/slots/all', { params });
            setExistingSlots(res.data);
        } catch (e) { console.error(e); }
        finally { setSlotsLoading(false); }
    }, [filterTour]);

    // Fetch availabilities
    useEffect(() => {
        if (activeTab === 'availabilities') fetchAvailabilities();
    }, [activeTab, fetchAvailabilities]);

    // Fetch epreuves for generation
    useEffect(() => {
        if (activeTab === 'generate') fetchEpreuves();
    }, [activeTab, fetchEpreuves]);

    // Fetch existing slots
    useEffect(() => {
        if (activeTab === 'slots') fetchExistingSlots();
    }, [activeTab, fetchExistingSlots]);

    // Generate slots
    const handleGenerate = async () => {
        if (!selectedEpreuve) { toast('Choisissez une \u00e9preuve', 'error'); return; }
        setGenerating(true);
        try {
            const startStr = format(currentWeekStart, 'yyyy-MM-dd');
            const endStr = format(addDays(currentWeekStart, 6), 'yyyy-MM-dd');
            const res = await api.post('/slots/generate', {
                epreuveId: selectedEpreuve,
                startDate: startStr,
                endDate: endStr,
                membersPerSlot,
                maxCandidates
            });
            setGeneratedResult(res.data);
            toast(`${res.data.summary.totalRooms} cr\u00e9neaux g\u00e9n\u00e9r\u00e9s !`, 'success');
        } catch (e: any) {
            toast(e.response?.data?.error || 'Erreur de g\u00e9n\u00e9ration', 'error');
        } finally { setGenerating(false); }
    };

    // Publish generated slots
    const handlePublish = async () => {
        if (!generatedResult) return;
        setPublishing(true);
        try {
            await api.post('/slots/publish', {
                epreuveId: selectedEpreuve,
                slots: generatedResult.slots
            });
            toast('Cr\u00e9neaux enregistr\u00e9s !', 'success');
            setGeneratedResult(null);
        } catch (e: any) {
            toast(e.response?.data?.error || 'Erreur de publication', 'error');
        } finally { setPublishing(false); }
    };

    // Update slot status (publish/close)
    const handleBulkStatus = async (slotIds: string[], status: string) => {
        try {
            await api.put('/slots/status/bulk', { slotIds, status });
            toast(`${slotIds.length} cr\u00e9neau(x) mis \u00e0 jour`, 'success');
            fetchExistingSlots();
        } catch (e) { toast('Erreur', 'error'); }
    };

    const handleDeleteSlot = async (id: string) => {
        if (!confirm('Supprimer ce cr\u00e9neau ?')) return;
        try {
            await api.delete(`/slots/${id}`);
            fetchExistingSlots();
        } catch (e) { toast('Erreur suppression', 'error'); }
    };

    // Build member color map for availability view
    const memberMap = useMemo(() => {
        const map: Record<string, { email: string; color: typeof MEMBER_COLORS[0] }> = {};
        let colorIdx = 0;
        availabilities.forEach(a => {
            if (a.member && !map[a.member.id]) {
                map[a.member.id] = {
                    email: a.member.email,
                    color: MEMBER_COLORS[colorIdx % MEMBER_COLORS.length]
                };
                colorIdx++;
            }
        });
        return map;
    }, [availabilities]);

    const slotMap = useMemo(() => {
        const map: Record<string, { members: Set<string>; slots: any[] }> = {};
        availabilities.forEach(a => {
            const dateStr = a.date ? format(new Date(a.date), 'yyyy-MM-dd') : '';
            if (!dateStr) return;
            const key = `${dateStr}-${a.startTime}`;
            if (!map[key]) map[key] = { members: new Set(), slots: [] };
            map[key].members.add(a.memberId);
            map[key].slots.push(a);
        });
        return map;
    }, [availabilities]);

    const maxOverlap = useMemo(() => {
        let max = 0;
        Object.values(slotMap).forEach(v => { if (v.members.size > max) max = v.members.size; });
        return max;
    }, [slotMap]);

    const memberList = Object.entries(memberMap);

    // TAB: Availabilities
    const renderAvailabilities = () => (
        <div className="flex flex-col gap-4 flex-1 min-h-0">
            <div className="flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
                    <Button variant="ghost" size="sm" onClick={() => setWeekOffset(weekOffset - 1)}>&lt;</Button>
                    <span className="text-sm font-medium w-40 text-center">
                        {format(currentWeekStart, 'd MMM', { locale: fr })} - {format(addDays(currentWeekStart, 4), 'd MMM yyyy', { locale: fr })}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => setWeekOffset(weekOffset + 1)}>&gt;</Button>
                </div>
                {maxOverlap >= 2 && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span>Chevauchement max:</span>
                        <span className="px-2 py-1 bg-emerald-100 text-emerald-800 rounded font-bold">{maxOverlap} membres</span>
                    </div>
                )}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-2 shrink-0">
                {memberList.map(([id, m]) => (
                    <div key={id} className={cn("flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border", m.color.bg, m.color.border, m.color.text)}>
                        <div className={cn("w-2 h-2 rounded-full", m.color.dot)} />
                        {m.email.split('@')[0]}
                    </div>
                ))}
                {memberList.length === 0 && (
                    <div className="text-sm text-gray-400 flex items-center gap-2"><Users size={16} />Aucune disponibilit&eacute; cette semaine</div>
                )}
            </div>

            {/* Calendar Grid */}
            <Card className="flex-1 flex flex-col overflow-hidden">
                <CardContent className="flex-1 p-0 overflow-auto flex">
                    {days.map(day => {
                        const dateStr = format(day, 'yyyy-MM-dd');
                        const dayKey = getDayKey(day);
                        const dayConfig = weeklySchedule?.[dayKey] || { start: dayStart, end: dayEnd, isOpen: true };
                        const totalMinutes = (dayEnd - dayStart) * 60;
                        const numberOfSlots = Math.floor(totalMinutes / slotDuration);
                        const dayAvails = availabilities.filter(a => a.date && format(new Date(a.date), 'yyyy-MM-dd') === dateStr);

                        return (
                            <div key={dateStr} className="flex-1 min-w-[180px] border-r border-gray-100 last:border-r-0 flex flex-col">
                                <div className="text-center p-3 border-b border-gray-100 bg-white sticky top-0 z-10">
                                    <div className="text-sm font-medium text-gray-500 uppercase">{format(day, 'EEEE', { locale: fr })}</div>
                                    <div className="text-2xl font-bold text-gray-900">{format(day, 'd')}</div>
                                </div>
                                <div className={cn("relative flex-1", dayConfig.isOpen ? "bg-white" : "bg-gray-100")} style={{ height: (dayEnd - dayStart) * HOUR_HEIGHT }}>
                                    {!dayConfig.isOpen && (
                                        <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm font-medium uppercase tracking-widest">Ferm&eacute;</div>
                                    )}

                                    {dayConfig.isOpen && Array.from({ length: numberOfSlots }).map((_, i) => {
                                        const slotTimeMinutes = i * slotDuration;
                                        const top = (slotTimeMinutes / 60) * HOUR_HEIGHT;
                                        const absoluteMinutes = (dayStart * 60) + slotTimeMinutes;
                                        const h = Math.floor(absoluteMinutes / 60);
                                        const m = absoluteMinutes % 60;
                                        const isFullHour = m === 0;
                                        const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                                        const overlapInfo = slotMap[`${dateStr}-${timeStr}`];
                                        const overlapCount = overlapInfo?.members.size || 0;

                                        return (
                                            <div key={i} className={cn("absolute w-full border-gray-100 text-xs pl-1 pointer-events-none flex items-center", isFullHour ? "border-b-2" : "border-b border-dashed opacity-50")} style={{ top, height: (slotDuration / 60) * HOUR_HEIGHT }}>
                                                {isFullHour && <span className="-mt-[20px] text-gray-300">{h}:00</span>}
                                                {overlapCount >= 2 && (
                                                    <span className={cn("absolute right-1 top-0.5 px-1.5 py-0.5 text-white text-[10px] font-bold rounded z-30", overlapCount >= membersPerSlot ? "bg-emerald-500" : "bg-orange-400")}>
                                                        {overlapCount}
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}

                                    {dayConfig.isOpen && dayAvails.map((avail: any, idx: number) => {
                                        const memberColor = memberMap[avail.memberId]?.color;
                                        if (!memberColor) return null;
                                        const [sh, sm] = avail.startTime.split(':').map(Number);
                                        const [eh, em] = avail.endTime.split(':').map(Number);
                                        const startMinutes = (sh - dayStart) * 60 + sm;
                                        const durationMinutes = (eh * 60 + em) - (sh * 60 + sm);
                                        const top = (startMinutes / 60) * HOUR_HEIGHT;
                                        const height = (durationMinutes / 60) * HOUR_HEIGHT;
                                        const slotKey = `${dateStr}-${avail.startTime}`;
                                        const slotData = slotMap[slotKey];
                                        const membersAtSlot = slotData ? Array.from(slotData.members) : [avail.memberId];
                                        const posInSlot = membersAtSlot.indexOf(avail.memberId);
                                        const totalInSlot = membersAtSlot.length;
                                        const leftPct = (posInSlot / totalInSlot) * 100;
                                        const widthPct = (1 / totalInSlot) * 100;

                                        return (
                                            <div key={avail.id || idx} className={cn("absolute rounded border-l-3 px-1 py-0.5 text-[10px] overflow-hidden z-20 border", memberColor.bg, memberColor.border, memberColor.text)} style={{ top: `${top}px`, height: `${Math.max(height, 16)}px`, left: `${leftPct}%`, width: `${widthPct}%` }} title={`${memberMap[avail.memberId]?.email} - ${avail.startTime} to ${avail.endTime}`}>
                                                <div className="truncate font-medium">{memberMap[avail.memberId]?.email.split('@')[0]}</div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </CardContent>
            </Card>
        </div>
    );

    // TAB: Generate
    const renderGenerate = () => (
        <div className="space-y-6">
            <div className="grid md:grid-cols-3 gap-6">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Param&egrave;tres de g&eacute;n&eacute;ration</CardTitle>
                        <CardDescription>Croisez les disponibilit&eacute;s pour cr&eacute;er des cr&eacute;neaux.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between bg-gray-50 p-2 rounded">
                            <Button variant="ghost" size="sm" onClick={() => setWeekOffset(weekOffset - 1)}>&lt;</Button>
                            <span className="text-sm font-medium">Sem. du {format(currentWeekStart, 'd MMM', { locale: fr })}</span>
                            <Button variant="ghost" size="sm" onClick={() => setWeekOffset(weekOffset + 1)}>&gt;</Button>
                        </div>

                        <div>
                            <Label>&Eacute;preuve</Label>
                            <select
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                value={selectedEpreuve}
                                onChange={e => {
                                    setSelectedEpreuve(e.target.value);
                                    const ep = epreuves.find((x: any) => x.id === e.target.value);
                                    if (ep) {
                                        setMaxCandidates(ep.isGroupEpreuve ? ep.groupSize : 1);
                                    }
                                }}
                            >
                                <option value="">-- Choisir --</option>
                                {epreuves.map((ep: any) => (
                                    <option key={ep.id} value={ep.id}>
                                        Tour {ep.tour} - {ep.name} ({ep.type})
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <Label>&Eacute;valuateurs par salle</Label>
                            <Input type="number" min={1} max={5} value={membersPerSlot} onChange={e => setMembersPerSlot(parseInt(e.target.value) || 2)} />
                        </div>

                        <div>
                            <Label>Candidats par cr&eacute;neau</Label>
                            <Input type="number" min={1} max={6} value={maxCandidates} onChange={e => setMaxCandidates(parseInt(e.target.value) || 1)} />
                            <p className="text-xs text-gray-500 mt-1">1 = individuel, 2-6 = groupe</p>
                        </div>

                        <Button className="w-full" onClick={handleGenerate} disabled={generating || !selectedEpreuve}>
                            {generating ? <Loader2 className="animate-spin mr-2" size={16} /> : <Calendar className="mr-2" size={16} />}
                            G&eacute;n&eacute;rer les cr&eacute;neaux
                        </Button>
                    </CardContent>
                </Card>

                {generatedResult && (
                    <div className="md:col-span-2">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <Check className="text-green-600" size={20} />
                                    R&eacute;sultat : {generatedResult.epreuve.name}
                                </CardTitle>
                                <CardDescription>
                                    {generatedResult.summary.totalRooms} cr&eacute;neaux &middot; Capacit&eacute; totale: {generatedResult.summary.totalCapacity} candidats
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3 max-h-96 overflow-auto">
                                    {generatedResult.slots.map((slot: any, i: number) => (
                                        <div key={i} className="border rounded-lg p-3">
                                            <div className="flex items-center gap-3 mb-2">
                                                <span className="font-bold text-sm">{format(new Date(slot.date), 'EEEE d MMMM', { locale: fr })}</span>
                                                <span className="text-sm text-gray-500">{slot.startTime} - {slot.endTime}</span>
                                                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{slot.totalAvailableMembers} membres dispo</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                {slot.rooms.map((room: any) => (
                                                    <div key={room.roomNumber} className="bg-gray-50 p-2 rounded text-xs">
                                                        <span className="font-bold">Salle {room.roomNumber}</span>
                                                        <span className="text-gray-500 ml-2">({room.maxCandidates} candidats max)</span>
                                                        <div className="mt-1 text-gray-600">
                                                            {room.members.map((m: any) => m.email.split('@')[0]).join(', ')}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="mt-4 flex justify-end">
                                    <Button onClick={handlePublish} disabled={publishing} className="bg-green-600 hover:bg-green-700 text-white">
                                        {publishing ? <Loader2 className="animate-spin mr-2" size={16} /> : <Check className="mr-2" size={16} />}
                                        Enregistrer les cr&eacute;neaux
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}
            </div>
        </div>
    );

    // TAB: Slots management
    const renderSlots = () => {
        const statusColors: Record<string, string> = {
            draft: 'bg-gray-100 text-gray-700',
            published: 'bg-green-100 text-green-700',
            closed: 'bg-red-100 text-red-700',
            cancelled: 'bg-gray-200 text-gray-500'
        };

        const statusLabels: Record<string, string> = {
            draft: 'Brouillon',
            published: 'Ouvert',
            closed: 'Ferm\u00e9',
            cancelled: 'Annul\u00e9'
        };

        const draftSlots = existingSlots.filter(s => s.status === 'draft');
        const publishedSlots = existingSlots.filter(s => s.status === 'published');

        return (
            <div className="space-y-6">
                {/* Bulk actions */}
                <div className="flex gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                        <Label className="text-sm">Filtrer tour:</Label>
                        <select className="border rounded px-2 py-1 text-sm" value={filterTour} onChange={e => setFilterTour(e.target.value)}>
                            <option value="">Tous</option>
                            <option value="1">Tour 1</option>
                            <option value="2">Tour 2</option>
                            <option value="3">Tour 3</option>
                        </select>
                    </div>
                    {draftSlots.length > 0 && (
                        <Button size="sm" className="bg-green-600 text-white" onClick={() => handleBulkStatus(draftSlots.map(s => s.id), 'published')}>
                            <Unlock size={14} className="mr-1" />
                            Ouvrir {draftSlots.length} brouillon(s) aux candidats
                        </Button>
                    )}
                    {publishedSlots.length > 0 && (
                        <Button size="sm" variant="outline" className="text-red-600 border-red-200" onClick={() => handleBulkStatus(publishedSlots.map(s => s.id), 'closed')}>
                            <Lock size={14} className="mr-1" />
                            Fermer {publishedSlots.length} cr&eacute;neau(x)
                        </Button>
                    )}
                </div>

                {slotsLoading ? (
                    <div className="flex justify-center py-12"><Loader2 className="animate-spin" /></div>
                ) : existingSlots.length === 0 ? (
                    <Card>
                        <CardContent className="py-12 text-center">
                            <Calendar size={48} className="mx-auto text-gray-300 mb-4" />
                            <h3 className="text-lg font-medium text-gray-500">Aucun cr&eacute;neau cr&eacute;&eacute;</h3>
                            <p className="text-sm text-gray-400 mt-2">Utilisez l&apos;onglet &quot;G&eacute;n&eacute;rer&quot; pour cr&eacute;er des cr&eacute;neaux.</p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="border rounded-lg overflow-hidden bg-white">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-gray-50 text-xs uppercase border-b">
                                <tr>
                                    <th className="px-4 py-3">&Eacute;preuve</th>
                                    <th className="px-4 py-3">Date</th>
                                    <th className="px-4 py-3">Horaire</th>
                                    <th className="px-4 py-3">Salle</th>
                                    <th className="px-4 py-3">&Eacute;valuateurs</th>
                                    <th className="px-4 py-3">Candidats</th>
                                    <th className="px-4 py-3">Statut</th>
                                    <th className="px-4 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {existingSlots.map((slot: any) => (
                                    <tr key={slot.id} className="hover:bg-gray-50">
                                        <td className="px-4 py-3 font-medium">{slot.epreuve?.name}</td>
                                        <td className="px-4 py-3">{format(new Date(slot.date), 'dd/MM/yyyy')}</td>
                                        <td className="px-4 py-3">{slot.startTime} - {slot.endTime}</td>
                                        <td className="px-4 py-3">{slot.room || '-'}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex flex-wrap gap-1">
                                                {slot.members?.map((m: any) => (
                                                    <span key={m.id} className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                                                        {m.member?.email?.split('@')[0]}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="font-bold">{slot.enrollments?.length || 0}</span>
                                            <span className="text-gray-400">/{slot.maxCandidates}</span>
                                            {slot.enrollments?.length > 0 && (
                                                <div className="mt-1 text-xs text-gray-500">
                                                    {slot.enrollments.map((e: any) => `${e.candidate?.firstName} ${e.candidate?.lastName}`).join(', ')}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={cn("px-2 py-1 rounded text-xs font-bold", statusColors[slot.status] || 'bg-gray-100')}>
                                                {statusLabels[slot.status] || slot.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="flex gap-1 justify-end">
                                                {slot.status === 'draft' && (
                                                    <Button size="sm" variant="ghost" className="text-green-600" onClick={() => handleBulkStatus([slot.id], 'published')}>
                                                        <Unlock size={14} />
                                                    </Button>
                                                )}
                                                {slot.status === 'published' && (
                                                    <Button size="sm" variant="ghost" className="text-orange-600" onClick={() => handleBulkStatus([slot.id], 'closed')}>
                                                        <Lock size={14} />
                                                    </Button>
                                                )}
                                                <Button size="sm" variant="ghost" className="text-red-500" onClick={() => handleDeleteSlot(slot.id)}>
                                                    <Trash2 size={14} />
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        );
    };

    if (loading && activeTab === 'availabilities') return <div className="flex h-96 items-center justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] gap-4">
            <div className="flex items-center justify-between shrink-0">
                <div>
                    <h1 className="text-2xl font-bold">Calendriers Crois&eacute;s &amp; Cr&eacute;neaux</h1>
                    <p className="text-sm text-gray-500">G&eacute;rez les disponibilit&eacute;s, g&eacute;n&eacute;rez des cr&eacute;neaux et g&eacute;rez les inscriptions.</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 shrink-0 w-fit">
                {([
                    { key: 'availabilities' as TabType, label: 'Disponibilit\u00e9s', icon: Eye },
                    { key: 'generate' as TabType, label: 'G\u00e9n\u00e9rer cr\u00e9neaux', icon: Calendar },
                    { key: 'slots' as TabType, label: 'G\u00e9rer cr\u00e9neaux', icon: Users },
                ]).map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={cn(
                            "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors",
                            activeTab === tab.key ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"
                        )}
                    >
                        <tab.icon size={16} />
                        {tab.label}
                    </button>
                ))}
            </div>

            {activeTab === 'availabilities' && renderAvailabilities()}
            {activeTab === 'generate' && renderGenerate()}
            {activeTab === 'slots' && renderSlots()}
        </div>
    );
}
