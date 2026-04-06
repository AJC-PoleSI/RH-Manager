"use client";

import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Calendar, Clock, Check, X, Users, MapPin, AlertTriangle } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

function canCancelSlot(dateStr: string, startTime?: string): boolean {
    if (!dateStr) return false;
    try {
        const d = new Date(dateStr);
        const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const time = startTime ? startTime.slice(0, 5) : '00:00';
        const slotStart = new Date(`${dStr}T${time}:00`);
        const now = new Date();
        const hoursUntil = (slotStart.getTime() - now.getTime()) / (1000 * 60 * 60);
        return hoursUntil >= 24;
    } catch {
        return false;
    }
}

function formatTimeRemaining(dateStr: string, startTime?: string): string {
    try {
        const d = new Date(dateStr);
        const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const time = startTime ? startTime.slice(0, 5) : '00:00';
        const slotStart = new Date(`${dStr}T${time}:00`);
        const now = new Date();
        const hoursUntil = (slotStart.getTime() - now.getTime()) / (1000 * 60 * 60);
        if (hoursUntil < 0) return 'Passé';
        if (hoursUntil < 1) return `${Math.round(hoursUntil * 60)}min`;
        if (hoursUntil < 24) return `${Math.round(hoursUntil)}h`;
        const days = Math.floor(hoursUntil / 24);
        return `${days}j`;
    } catch {
        return '';
    }
}

export default function CandidateSlotsPage() {
    const { user } = useAuth();
    const { toast } = useToast();
    const [slots, setSlots] = useState<any[]>([]);
    const [enrollments, setEnrollments] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [enrolling, setEnrolling] = useState<string | null>(null);
    const [cancelling, setCancelling] = useState<string | null>(null);
    const [planningVisible, setPlanningVisible] = useState<boolean | null>(null);

    const fetchData = useCallback(async () => {
        try {
            // Check if planning is visible for candidates
            const settingsRes = await api.get('/settings');
            const visible = settingsRes.data?.planning_visible_candidats;
            setPlanningVisible(visible === 'true' || visible === true);

            if (visible !== 'true' && visible !== true) {
                setLoading(false);
                return;
            }

            const [slotsRes, enrollRes] = await Promise.all([
                api.get('/slots/available'),
                api.get('/slots/my-enrollments')
            ]);
            setSlots(slotsRes.data);
            setEnrollments(enrollRes.data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleEnroll = async (slotId: string) => {
        setEnrolling(slotId);
        try {
            await api.post('/slots/enroll', { slotId });
            toast('Inscription confirmée !', 'success');
            fetchData();
        } catch (e: any) {
            toast(e.response?.data?.error || 'Erreur lors de l\'inscription', 'error');
        } finally {
            setEnrolling(null);
        }
    };

    const handleCancel = async (enrollment: any) => {
        const slotId = enrollment.slotId;
        // Client-side 24h check
        if (!canCancelSlot(enrollment.date, enrollment.startTime)) {
            toast('Annulation impossible : le créneau commence dans moins de 24 heures.', 'error');
            return;
        }
        setCancelling(slotId);
        try {
            await api.delete(`/slots/enroll/${slotId}`);
            toast('Inscription annulée', 'success');
            fetchData();
        } catch (e: any) {
            toast(e.response?.data?.error || 'Erreur lors de l\'annulation', 'error');
        } finally {
            setCancelling(null);
        }
    };

    // Group slots by epreuve
    const slotsByEpreuve = slots.reduce((acc: Record<string, any[]>, slot: any) => {
        const key = slot.epreuve?.name || 'Inconnu';
        if (!acc[key]) acc[key] = [];
        acc[key].push(slot);
        return acc;
    }, {});

    if (loading) return <div className="flex h-96 items-center justify-center"><Loader2 className="animate-spin" size={32} /></div>;

    // Planning not visible for candidates
    if (planningVisible === false) {
        return (
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-bold">Inscription aux créneaux</h1>
                    <p className="text-sm text-gray-500 mt-1">Choisissez vos créneaux d&apos;évaluation parmi ceux disponibles.</p>
                </div>
                <div className="flex items-center justify-center py-16">
                    <div className="text-center max-w-md">
                        <div className="w-20 h-20 rounded-full bg-blue-50 border-2 border-blue-200 flex items-center justify-center mx-auto mb-5">
                            <Calendar size={36} className="text-blue-400" />
                        </div>
                        <h2 className="text-lg font-semibold text-gray-800 mb-2">Planning en cours de préparation</h2>
                        <p className="text-sm text-gray-500 leading-relaxed">
                            Les créneaux d&apos;évaluation ne sont pas encore disponibles. Vous serez informé(e) dès qu&apos;ils seront publiés.
                        </p>
                        <div className="mt-5 flex items-center justify-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
                            <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0.2s' }} />
                            <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0.4s' }} />
                        </div>
                        <button
                            onClick={() => { setLoading(true); fetchData(); }}
                            className="mt-6 px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors border border-gray-200"
                        >
                            Actualiser
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold">Inscription aux créneaux</h1>
                <p className="text-sm text-gray-500 mt-1">Choisissez vos créneaux d&apos;évaluation parmi ceux disponibles.</p>
            </div>

            {/* My enrollments */}
            {enrollments.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <Check size={20} className="text-green-600" />
                            Mes inscriptions ({enrollments.length})
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid gap-3">
                            {enrollments.map((e: any) => {
                                const canCancel = canCancelSlot(e.date, e.startTime);
                                const remaining = formatTimeRemaining(e.date, e.startTime);
                                return (
                                    <div key={e.id} className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg flex-wrap gap-2">
                                        <div className="flex items-center gap-4 flex-wrap">
                                            <div className="flex items-center gap-2 text-green-700">
                                                <Calendar size={16} />
                                                <span className="font-medium">
                                                    {format(new Date(e.date), 'EEEE d MMMM', { locale: fr })}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 text-green-600">
                                                <Clock size={14} />
                                                <span className="text-sm">{e.startTime} - {e.endTime}</span>
                                            </div>
                                            {/* ═══ RÈGLE 3 : Salle visible ═══ */}
                                            {e.room && (
                                                <div className="flex items-center gap-1.5 text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                                                    <MapPin size={12} />
                                                    <span className="text-xs font-semibold">{e.room}</span>
                                                </div>
                                            )}
                                            <span className="text-sm font-bold text-green-800">{e.epreuve?.name}</span>
                                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Tour {e.epreuve?.tour}</span>
                                        </div>

                                        {/* ═══ RÈGLE 1 : Bouton annulation conditionnel 24h ═══ */}
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-gray-400">dans {remaining}</span>
                                            {canCancel ? (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                                    onClick={() => handleCancel(e)}
                                                    disabled={cancelling === e.slotId}
                                                >
                                                    {cancelling === e.slotId ? (
                                                        <Loader2 size={14} className="animate-spin mr-1" />
                                                    ) : (
                                                        <X size={16} className="mr-1" />
                                                    )}
                                                    Annuler
                                                </Button>
                                            ) : (
                                                <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">
                                                    <AlertTriangle size={12} />
                                                    &lt; 24h
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Available slots by epreuve */}
            {Object.keys(slotsByEpreuve).length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center">
                        <Calendar size={48} className="mx-auto text-gray-300 mb-4" />
                        <h3 className="text-lg font-medium text-gray-500">Aucun créneau disponible</h3>
                        <p className="text-sm text-gray-400 mt-2">Les créneaux d&apos;inscription ne sont pas encore ouverts.</p>
                    </CardContent>
                </Card>
            ) : (
                Object.entries(slotsByEpreuve).map(([epreuveName, epreuveSlots]) => (
                    <Card key={epreuveName}>
                        <CardHeader>
                            <CardTitle className="text-lg">{epreuveName}</CardTitle>
                            <p className="text-sm text-gray-500">
                                Tour {(epreuveSlots as any[])[0]?.tour} &middot; {(epreuveSlots as any[]).filter((s: any) => !s.isFull).length} créneau(x) disponible(s)
                            </p>
                        </CardHeader>
                        <CardContent>
                            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                                {(epreuveSlots as any[]).map((slot: any) => {
                                    const isEnrolled = slot.isEnrolled;
                                    const isFull = slot.isFull;

                                    return (
                                        <div
                                            key={slot.id}
                                            className={`p-4 rounded-lg border-2 transition-all ${
                                                isEnrolled
                                                    ? 'border-green-400 bg-green-50'
                                                    : isFull
                                                        ? 'border-gray-200 bg-gray-50 opacity-60'
                                                        : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/30'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2 mb-2">
                                                <Calendar size={16} className="text-gray-400" />
                                                <span className="font-medium text-sm">
                                                    {format(new Date(slot.date), 'EEEE d MMMM', { locale: fr })}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 mb-2">
                                                <Clock size={14} className="text-gray-400" />
                                                <span className="text-sm text-gray-600">{slot.startTime} - {slot.endTime}</span>
                                            </div>
                                            {/* ═══ RÈGLE 3 : Salle visible ═══ */}
                                            {slot.room && (
                                                <div className="flex items-center gap-2 mb-2">
                                                    <MapPin size={14} className="text-blue-500" />
                                                    <span className="text-sm font-semibold text-blue-700">{slot.room}</span>
                                                </div>
                                            )}
                                            <div className="flex items-center gap-2 mb-3">
                                                <Users size={14} className="text-gray-400" />
                                                <span className="text-xs text-gray-500">
                                                    {slot.enrolledCount}/{slot.maxCandidates} inscrits
                                                </span>
                                                {isFull && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded font-medium">Complet</span>}
                                            </div>

                                            {isEnrolled ? (
                                                <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
                                                    <Check size={16} /> Inscrit
                                                </div>
                                            ) : isFull ? (
                                                <Button disabled className="w-full" size="sm">Complet</Button>
                                            ) : (
                                                <Button
                                                    className="w-full"
                                                    size="sm"
                                                    onClick={() => handleEnroll(slot.id)}
                                                    disabled={enrolling === slot.id}
                                                >
                                                    {enrolling === slot.id ? <Loader2 className="animate-spin mr-2" size={14} /> : null}
                                                    S&apos;inscrire
                                                </Button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>
                ))
            )}
        </div>
    );
}
