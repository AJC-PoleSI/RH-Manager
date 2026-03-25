"use client";

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import api from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
    Calendar, Clock, Check, X, Users, Loader2,
    ArrowUp, ArrowDown, FileText, Star, AlertCircle,
    ChevronDown, ChevronUp, MapPin, Info, Shield
} from 'lucide-react';
import clsx from 'clsx';

const POLES = ['Communication', 'Marketing', 'RH', 'SI', 'Finance'];

export default function CandidateDashboard() {
    const { user } = useAuth();
    const { toast } = useToast();

    // Data states
    const [slots, setSlots] = useState<any[]>([]);
    const [enrollments, setEnrollments] = useState<any[]>([]);
    const [epreuves, setEpreuves] = useState<any[]>([]);
    const [poles, setPoles] = useState<string[]>(POLES);
    const [loading, setLoading] = useState(true);
    const [enrolling, setEnrolling] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    // UI states
    const [expandedSection, setExpandedSection] = useState<string | null>('planning');
    const [currentTour, setCurrentTour] = useState(1);

    // ---- DATA FETCHING ----
    const fetchAll = useCallback(async () => {
        try {
            const [slotsRes, enrollRes, epreuvesRes] = await Promise.all([
                api.get('/slots/available').catch(() => ({ data: [] })),
                api.get('/slots/my-enrollments').catch(() => ({ data: [] })),
                api.get('/epreuves').catch(() => ({ data: [] })),
            ]);
            setSlots(slotsRes.data || []);
            setEnrollments(enrollRes.data || []);
            setEpreuves(epreuvesRes.data || []);

            // Fetch wishes
            if (user?.id) {
                try {
                    const wishRes = await api.get(`/wishes/${user.id}`);
                    if (wishRes.data?.length > 0) {
                        const ordered = wishRes.data
                            .sort((a: any, b: any) => a.rank - b.rank)
                            .map((w: any) => w.pole);
                        const remaining = POLES.filter(p => !ordered.includes(p));
                        setPoles([...ordered, ...remaining]);
                    }
                } catch { }
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [user?.id]);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    // ---- SLOT ENROLLMENT ----
    const handleEnroll = async (slotId: string) => {
        setEnrolling(slotId);
        try {
            await api.post('/slots/enroll', { slotId });
            toast('Inscription confirmée !', 'success');
            fetchAll();
        } catch (e: any) {
            toast(e.response?.data?.error || "Erreur lors de l'inscription", 'error');
        } finally {
            setEnrolling(null);
        }
    };

    const handleCancel = async (slotId: string) => {
        if (!confirm('Êtes-vous sûr de vouloir vous désinscrire de ce créneau ?')) return;
        try {
            await api.delete(`/slots/enroll/${slotId}`);
            toast('Désinscription effectuée', 'success');
            fetchAll();
        } catch (e: any) {
            toast(e.response?.data?.error || "Erreur lors de l'annulation", 'error');
        }
    };

    // ---- WISHES ----
    const moveUp = (index: number) => {
        if (index === 0) return;
        const updated = [...poles];
        [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
        setPoles(updated);
        setSaved(false);
    };

    const moveDown = (index: number) => {
        if (index === poles.length - 1) return;
        const updated = [...poles];
        [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
        setPoles(updated);
        setSaved(false);
    };

    const handleSaveWishes = async () => {
        if (!user?.id) return;
        setSaving(true);
        try {
            const wishes = poles.map((pole, index) => ({ pole, rank: index + 1 }));
            await api.put(`/wishes/${user.id}`, { wishes });
            setSaved(true);
            toast('Voeux sauvegardés !', 'success');
        } catch (e) {
            toast("Erreur lors de la sauvegarde des voeux.", 'error');
        } finally {
            setSaving(false);
        }
    };

    // ---- GROUP SLOTS  ----
    const slotsByEpreuve = slots.reduce((acc: Record<string, any[]>, slot: any) => {
        const key = slot.epreuve?.name || 'Inconnu';
        if (!acc[key]) acc[key] = [];
        acc[key].push(slot);
        return acc;
    }, {});

    const toggleSection = (section: string) => {
        setExpandedSection(expandedSection === section ? null : section);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <Loader2 className="animate-spin text-blue-500" size={40} />
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            {/* =========================================== */}
            {/* HEADER */}
            {/* =========================================== */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl p-6 text-white shadow-lg">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center text-xl font-black backdrop-blur-sm">
                        S
                    </div>
                    <div>
                        <h1 className="text-xl font-black tracking-tight">STRETCHER App</h1>
                        <p className="text-blue-200 text-xs">Tableau de bord Candidat</p>
                    </div>
                </div>
                <div className="mt-4">
                    <h2 className="text-2xl font-bold">Bienvenue, {user?.firstName} !</h2>
                    <p className="text-blue-100 text-sm mt-1">Votre espace de candidature centralisé.</p>
                </div>
            </div>

            {/* =========================================== */}
            {/* STATUS NOTIFICATIONS */}
            {/* =========================================== */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl border border-blue-200 p-4 flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                        <Info size={18} className="text-blue-600" />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-blue-600 uppercase">Tour actuel</p>
                        <p className="text-lg font-black text-gray-800">Tour {currentTour}</p>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-green-200 p-4 flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                        <Check size={18} className="text-green-600" />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-green-600 uppercase">Inscriptions</p>
                        <p className="text-lg font-black text-gray-800">{enrollments.length} créneau{enrollments.length !== 1 ? 'x' : ''}</p>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-amber-200 p-4 flex items-center gap-3">
                    <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                        <Star size={18} className="text-amber-600" />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-amber-600 uppercase">Action requise</p>
                        <p className="text-sm font-medium text-gray-700">
                            {enrollments.length === 0 && Object.keys(slotsByEpreuve).length > 0
                                ? "Inscrivez-vous aux créneaux"
                                : saved ? "Voeux enregistrés ✓" : "Classez vos pôles préférés"
                            }
                        </p>
                    </div>
                </div>
            </div>

            {/* =========================================== */}
            {/* SECTION 1: PLANNING FINAL — AUTO-INSCRIPTION */}
            {/* =========================================== */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <button
                    onClick={() => toggleSection('planning')}
                    className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <Calendar size={20} className="text-blue-600" />
                        <div className="text-left">
                            <h3 className="text-lg font-bold text-gray-800">Planning Final — Inscription Créneaux</h3>
                            <p className="text-xs text-gray-500">Inscrivez-vous aux créneaux d'évaluation disponibles</p>
                        </div>
                    </div>
                    {expandedSection === 'planning' ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </button>

                {expandedSection === 'planning' && (
                    <div className="px-6 pb-6 space-y-5 border-t border-gray-100 pt-4">
                        {/* My current enrollments */}
                        {enrollments.length > 0 && (
                            <div>
                                <h4 className="text-sm font-bold text-green-700 uppercase mb-3 flex items-center gap-2">
                                    <Check size={14} /> Mes inscriptions ({enrollments.length})
                                </h4>
                                <div className="grid gap-3">
                                    {enrollments.map((e: any) => (
                                        <div key={e.id} className="flex items-center justify-between p-4 bg-green-50 border-2 border-green-200 rounded-xl">
                                            <div className="flex items-center gap-4 flex-wrap">
                                                <div className="flex items-center gap-2 text-green-700">
                                                    <Calendar size={16} />
                                                    <span className="font-bold text-sm">
                                                        {format(new Date(e.date), 'EEEE d MMMM', { locale: fr })}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2 text-green-600">
                                                    <Clock size={14} />
                                                    <span className="text-sm">{e.startTime} - {e.endTime}</span>
                                                </div>
                                                {e.room && (
                                                    <div className="flex items-center gap-1.5 text-green-600">
                                                        <MapPin size={14} />
                                                        <span className="text-sm">{e.room}</span>
                                                    </div>
                                                )}
                                                <span className="text-sm font-bold text-green-800">{e.epreuve?.name}</span>
                                                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Tour {e.epreuve?.tour}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="group relative">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="text-red-500 hover:text-red-700 hover:bg-red-50 border border-red-200"
                                                        onClick={() => handleCancel(e.slotId)}
                                                    >
                                                        <X size={14} className="mr-1" /> Me désinscrire
                                                    </Button>
                                                    <div className="absolute bottom-full right-0 mb-2 px-3 py-1.5 bg-gray-800 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                                                        <Shield size={10} className="inline mr-1" />
                                                        Seul vous pouvez vous désinscrire de ce créneau.
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Available slots by epreuve */}
                        {Object.keys(slotsByEpreuve).length === 0 ? (
                            <div className="text-center py-8">
                                <Calendar size={40} className="mx-auto text-gray-300 mb-3" />
                                <h4 className="text-base font-medium text-gray-500">Aucun créneau disponible</h4>
                                <p className="text-sm text-gray-400 mt-1">Les inscriptions ne sont pas encore ouvertes pour ce tour.</p>
                            </div>
                        ) : (
                            Object.entries(slotsByEpreuve).map(([epreuveName, epreuveSlots]) => (
                                <div key={epreuveName} className="border border-gray-200 rounded-xl overflow-hidden">
                                    <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                                        <div className="flex items-center justify-between">
                                            <h4 className="font-bold text-gray-800">{epreuveName}</h4>
                                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                                <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                                                    Tour {(epreuveSlots as any[])[0]?.tour}
                                                </span>
                                                <span>
                                                    {(epreuveSlots as any[]).filter((s: any) => !s.isFull).length} créneau(x) disponible(s)
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="p-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                                        {(epreuveSlots as any[]).map((slot: any) => {
                                            const isEnrolled = slot.isEnrolled;
                                            const isFull = slot.isFull;
                                            const remainingPlaces = slot.maxCandidates - slot.enrolledCount;

                                            return (
                                                <div
                                                    key={slot.id}
                                                    className={clsx(
                                                        "p-4 rounded-xl border-2 transition-all",
                                                        isEnrolled
                                                            ? "border-green-400 bg-green-50 ring-2 ring-green-200"
                                                            : isFull
                                                                ? "border-gray-200 bg-gray-50 opacity-50"
                                                                : "border-gray-200 hover:border-blue-300 hover:bg-blue-50/30 hover:shadow-sm"
                                                    )}
                                                >
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <Calendar size={15} className="text-gray-400" />
                                                        <span className="font-medium text-sm text-gray-800">
                                                            {format(new Date(slot.date), 'EEEE d MMMM', { locale: fr })}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2 mb-1.5">
                                                        <Clock size={14} className="text-gray-400" />
                                                        <span className="text-sm text-gray-600">{slot.startTime} - {slot.endTime}</span>
                                                    </div>
                                                    {slot.epreuve?.durationMinutes && (
                                                        <div className="text-xs text-gray-400 mb-2 ml-6">
                                                            Durée : {slot.epreuve.durationMinutes} min · {slot.epreuve.type}
                                                        </div>
                                                    )}

                                                    {/* Places remaining */}
                                                    <div className="flex items-center gap-2 mb-3">
                                                        <Users size={14} className={clsx(isFull ? "text-red-400" : "text-blue-400")} />
                                                        <span className={clsx(
                                                            "text-xs font-medium",
                                                            isFull ? "text-red-600" : remainingPlaces <= 2 ? "text-orange-600" : "text-blue-600"
                                                        )}>
                                                            {isFull
                                                                ? "Complet"
                                                                : `${remainingPlaces} place${remainingPlaces > 1 ? 's' : ''} restante${remainingPlaces > 1 ? 's' : ''} / ${slot.maxCandidates}`
                                                            }
                                                        </span>
                                                    </div>

                                                    {/* Action button */}
                                                    {isEnrolled ? (
                                                        <div className="space-y-2">
                                                            <div className="flex items-center gap-2 text-green-600 text-sm font-bold">
                                                                <Check size={16} /> Vous êtes inscrit(e)
                                                            </div>
                                                            <div className="group relative">
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    className="w-full text-red-500 hover:text-red-700 hover:bg-red-50 border border-red-200"
                                                                    onClick={() => handleCancel(slot.id)}
                                                                >
                                                                    <X size={14} className="mr-1" /> Me désinscrire
                                                                </Button>
                                                                <p className="text-[10px] text-gray-400 mt-1 text-center flex items-center justify-center gap-1">
                                                                    <Shield size={10} /> Seul vous pouvez vous désinscrire de ce créneau.
                                                                </p>
                                                            </div>
                                                        </div>
                                                    ) : isFull ? (
                                                        <Button disabled className="w-full" size="sm">Complet</Button>
                                                    ) : (
                                                        <Button
                                                            className="w-full bg-green-500 hover:bg-green-600 text-white"
                                                            size="sm"
                                                            onClick={() => handleEnroll(slot.id)}
                                                            disabled={enrolling === slot.id}
                                                        >
                                                            {enrolling === slot.id ? <Loader2 className="animate-spin mr-2" size={14} /> : null}
                                                            M'inscrire
                                                        </Button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>

            {/* =========================================== */}
            {/* SECTION 2: CHOIX DE PÔLE */}
            {/* =========================================== */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <button
                    onClick={() => toggleSection('poles')}
                    className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <Star size={20} className="text-amber-500" />
                        <div className="text-left">
                            <h3 className="text-lg font-bold text-gray-800">Choix de Pôle</h3>
                            <p className="text-xs text-gray-500">
                                {currentTour <= 2
                                    ? "Renseignement : indiquez vos préférences (non engageant)"
                                    : "Tour 3 : Classez vos 3 premiers vœux (engageant)"
                                }
                            </p>
                        </div>
                    </div>
                    {expandedSection === 'poles' ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </button>

                {expandedSection === 'poles' && (
                    <div className="px-6 pb-6 border-t border-gray-100 pt-4">
                        {currentTour <= 2 && (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm text-blue-700 flex items-start gap-2">
                                <Info size={16} className="shrink-0 mt-0.5" />
                                <span>Pour les Tours 1 et 2, votre classement est à titre informatif uniquement. Au Tour 3, il deviendra votre classement officiel de vœux.</span>
                            </div>
                        )}
                        {currentTour >= 3 && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-700 flex items-start gap-2">
                                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                                <span><strong>Tour 3 :</strong> Votre classement des pôles est maintenant engageant. Classez soigneusement vos 3 premiers vœux.</span>
                            </div>
                        )}

                        <div className="space-y-2">
                            {poles.map((pole, index) => (
                                <div
                                    key={pole}
                                    className={clsx(
                                        "flex items-center gap-3 p-3 rounded-xl border transition-colors",
                                        index < 3 && currentTour >= 3 ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-gray-200 hover:bg-gray-100"
                                    )}
                                >
                                    <span className={clsx(
                                        "w-8 h-8 flex items-center justify-center rounded-full font-bold text-sm",
                                        index < 3 ? "bg-amber-500 text-white" : "bg-gray-200 text-gray-600"
                                    )}>
                                        {index + 1}
                                    </span>
                                    <span className="flex-1 font-medium text-gray-800">{pole}</span>
                                    <div className="flex gap-1">
                                        <Button variant="ghost" size="sm" onClick={() => moveUp(index)} disabled={index === 0}>
                                            <ArrowUp size={16} />
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={() => moveDown(index)} disabled={index === poles.length - 1}>
                                            <ArrowDown size={16} />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="flex justify-end pt-4">
                            <Button onClick={handleSaveWishes} disabled={saving}>
                                {saving ? <Loader2 className="animate-spin mr-2" size={16} /> : saved ? <Check className="mr-2" size={16} /> : null}
                                {saved ? 'Sauvegardé ✓' : 'Sauvegarder mes choix'}
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* =========================================== */}
            {/* SECTION 3: DOCUMENTS & ÉPREUVES */}
            {/* =========================================== */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <button
                    onClick={() => toggleSection('documents')}
                    className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <FileText size={20} className="text-indigo-500" />
                        <div className="text-left">
                            <h3 className="text-lg font-bold text-gray-800">Documents & Épreuves</h3>
                            <p className="text-xs text-gray-500">{epreuves.length} épreuve(s) pour votre parcours</p>
                        </div>
                    </div>
                    {expandedSection === 'documents' ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </button>

                {expandedSection === 'documents' && (
                    <div className="px-6 pb-6 border-t border-gray-100 pt-4">
                        {epreuves.length === 0 ? (
                            <div className="text-center py-6 text-gray-400">
                                <FileText size={32} className="mx-auto mb-2 opacity-50" />
                                <p className="text-sm">Aucune épreuve disponible pour le moment.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {epreuves.map((epreuve: any) => (
                                    <div key={epreuve.id} className="p-4 bg-gray-50 rounded-xl border border-gray-200 hover:bg-gray-100 transition-colors">
                                        <div className="flex justify-between items-start mb-2">
                                            <h4 className="font-bold text-sm text-gray-800">{epreuve.name}</h4>
                                            <span className="bg-indigo-100 text-indigo-700 text-[10px] px-2 py-0.5 rounded-full font-bold">
                                                Tour {epreuve.tour}
                                            </span>
                                        </div>
                                        <div className="space-y-1 text-xs text-gray-500">
                                            <div className="flex justify-between">
                                                <span>Type</span>
                                                <span className="font-medium text-gray-700">{epreuve.type}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>Durée</span>
                                                <span className="font-medium text-gray-700">{epreuve.durationMinutes} min</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
