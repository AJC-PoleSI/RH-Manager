"use client";

import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Calendar, Clock, Check, X, Users } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

export default function CandidateSlotsPage() {
    const { user } = useAuth();
    const { toast } = useToast();
    const [slots, setSlots] = useState<any[]>([]);
    const [enrollments, setEnrollments] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [enrolling, setEnrolling] = useState<string | null>(null);

    const fetchData = async () => {
        try {
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
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleEnroll = async (slotId: string) => {
        setEnrolling(slotId);
        try {
            await api.post('/slots/enroll', { slotId });
            toast('Inscription confirm\u00e9e !', 'success');
            fetchData();
        } catch (e: any) {
            toast(e.response?.data?.error || 'Erreur lors de l\'inscription', 'error');
        } finally {
            setEnrolling(null);
        }
    };

    const handleCancel = async (slotId: string) => {
        try {
            await api.delete(`/slots/enroll/${slotId}`);
            toast('Inscription annul\u00e9e', 'success');
            fetchData();
        } catch (e: any) {
            toast(e.response?.data?.error || 'Erreur lors de l\'annulation', 'error');
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

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold">Inscription aux cr&eacute;neaux</h1>
                <p className="text-sm text-gray-500 mt-1">Choisissez vos cr&eacute;neaux d&apos;&eacute;valuation parmi ceux disponibles.</p>
            </div>

            {/* My enrollments */}
            {enrollments.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <Check size={20} className="text-green-600" />
                            Mes inscriptions
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid gap-3">
                            {enrollments.map((e: any) => (
                                <div key={e.id} className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
                                    <div className="flex items-center gap-4">
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
                                        <span className="text-sm font-bold text-green-800">{e.epreuve?.name}</span>
                                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Tour {e.epreuve?.tour}</span>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                        onClick={() => handleCancel(e.slotId)}
                                    >
                                        <X size={16} className="mr-1" /> Annuler
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Available slots by epreuve */}
            {Object.keys(slotsByEpreuve).length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center">
                        <Calendar size={48} className="mx-auto text-gray-300 mb-4" />
                        <h3 className="text-lg font-medium text-gray-500">Aucun cr&eacute;neau disponible</h3>
                        <p className="text-sm text-gray-400 mt-2">Les cr&eacute;neaux d&apos;inscription ne sont pas encore ouverts.</p>
                    </CardContent>
                </Card>
            ) : (
                Object.entries(slotsByEpreuve).map(([epreuveName, epreuveSlots]) => (
                    <Card key={epreuveName}>
                        <CardHeader>
                            <CardTitle className="text-lg">{epreuveName}</CardTitle>
                            <p className="text-sm text-gray-500">
                                Tour {(epreuveSlots as any[])[0]?.tour} &middot; {(epreuveSlots as any[]).filter((s: any) => !s.isFull).length} cr&eacute;neau(x) disponible(s)
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
                                            <div className="flex items-center gap-2 mb-3">
                                                <Clock size={14} className="text-gray-400" />
                                                <span className="text-sm text-gray-600">{slot.startTime} - {slot.endTime}</span>
                                            </div>
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
