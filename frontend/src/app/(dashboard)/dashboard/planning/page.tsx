"use client";

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';

interface Epreuve {
    id: string;
    name: string;
    type: string;
    tour: string;
    isCommune: boolean;
    dateDebut?: string;
    dateFin?: string;
}

interface SlotAvailability {
    [key: string]: boolean;
}

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];
const TIME_SLOTS = ['09h', '10h', '11h', '12h', '13h', '14h', '15h', '16h'];

function getAvailBg(count: number): string {
    if (count >= 3) return '#EFF6FF';
    if (count === 2) return '#FEF9C3';
    return '#FFF0F3';
}

function getAvailBorder(count: number): string {
    if (count >= 3) return '#BFDBFE';
    if (count === 2) return '#FDE68A';
    return '#FECDD3';
}

function getStatusBadge(status: string) {
    if (status === 'Complet') return { bg: '#DCFCE7', text: '#166534', border: '#BBF7D0' };
    if (status === 'Disponible') return { bg: '#EFF6FF', text: '#1E40AF', border: '#BFDBFE' };
    return { bg: '#FFF0F3', text: '#9F1239', border: '#FECDD3' };
}

export default function PlanningPage() {
    const { user } = useAuth();
    const { toast } = useToast();
    const isAdmin = user?.isAdmin === true;

    const [epreuves, setEpreuves] = useState<Epreuve[]>([]);
    const [selectedEpreuveId, setSelectedEpreuveId] = useState<string>('');
    const [loading, setLoading] = useState(true);

    // Admin state
    const [availabilityData, setAvailabilityData] = useState<Record<string, number>>({});
    const [sallesParCreneau, setSallesParCreneau] = useState(2);
    const [evalParSalle, setEvalParSalle] = useState(3);
    const [inscriptionData, setInscriptionData] = useState<{ creneau: string; inscrits: number; capacite: number; statut: string }[]>([]);
    const [saisiOuverte, setSaisiOuverte] = useState(false);
    const [inscriptionsOuvertes, setInscriptionsOuvertes] = useState(false);

    // Member state
    const [memberAvailabilities, setMemberAvailabilities] = useState<Record<string, SlotAvailability>>({});

    const fetchEpreuves = useCallback(async () => {
        try {
            const res = await api.get('/epreuves');
            const nonCommune = (res.data || []).filter((e: Epreuve) => !e.isCommune);
            setEpreuves(nonCommune);
            if (nonCommune.length > 0 && !selectedEpreuveId) {
                setSelectedEpreuveId(nonCommune[0].id);
            }
        } catch (e) {
            console.error('Erreur chargement epreuves:', e);
        } finally {
            setLoading(false);
        }
    }, [selectedEpreuveId]);

    useEffect(() => {
        fetchEpreuves();
    }, [fetchEpreuves]);

    // Fetch real availability data from API
    const fetchAvailabilityData = useCallback(async () => {
        if (!isAdmin || !selectedEpreuveId) return;
        try {
            const res = await api.get('/availability/all');
            const data: Record<string, number> = {};
            // Initialize all cells to 0
            DAYS.forEach(day => {
                TIME_SLOTS.forEach(slot => {
                    data[`${day}-${slot}`] = 0;
                });
            });
            // Count availabilities per day/slot
            (res.data || []).forEach((a: any) => {
                const dayMap: Record<string, string> = {
                    'monday': 'Lun', 'tuesday': 'Mar', 'wednesday': 'Mer',
                    'thursday': 'Jeu', 'friday': 'Ven',
                    'mon': 'Lun', 'tue': 'Mar', 'wed': 'Mer', 'thu': 'Jeu', 'fri': 'Ven',
                };
                const dayLabel = dayMap[a.weekday?.toLowerCase()] || '';
                if (!dayLabel) return;
                const startHour = parseInt(a.start_time || a.startTime || '0');
                const slotLabel = `${startHour.toString().padStart(2, '0')}h`;
                const key = `${dayLabel}-${slotLabel}`;
                if (data[key] !== undefined) {
                    data[key] = (data[key] || 0) + 1;
                }
            });
            setAvailabilityData(data);
        } catch (e) {
            console.error('Erreur chargement dispos:', e);
            // Fallback to empty data
            const data: Record<string, number> = {};
            DAYS.forEach(day => {
                TIME_SLOTS.forEach(slot => {
                    data[`${day}-${slot}`] = 0;
                });
            });
            setAvailabilityData(data);
        }
    }, [isAdmin, selectedEpreuveId]);

    // Fetch slots for inscription data
    const fetchSlotData = useCallback(async () => {
        if (!isAdmin || !selectedEpreuveId) return;
        try {
            const res = await api.get('/slots/all');
            const slots = (res.data || []).filter((s: any) => s.epreuve_id === selectedEpreuveId || s.epreuveId === selectedEpreuveId);
            const mapped = slots.map((s: any) => {
                const inscrits = s.enrollments?.length || 0;
                const capacite = s.max_candidates || s.maxCandidates || 1;
                let statut = 'Disponible';
                if (inscrits >= capacite) statut = 'Complet';
                else if (inscrits === 0) statut = 'Incomplet';
                return {
                    creneau: `${s.start_time || s.startTime || ''} - ${s.end_time || s.endTime || ''}`,
                    inscrits,
                    capacite,
                    statut,
                };
            });
            setInscriptionData(mapped);
        } catch {
            setInscriptionData([]);
        }
    }, [isAdmin, selectedEpreuveId]);

    useEffect(() => {
        fetchAvailabilityData();
        fetchSlotData();
    }, [fetchAvailabilityData, fetchSlotData]);

    // Initialize member availabilities per epreuve
    useEffect(() => {
        if (!isAdmin && epreuves.length > 0) {
            const initial: Record<string, SlotAvailability> = {};
            epreuves.forEach(ep => {
                if (!initial[ep.id]) {
                    initial[ep.id] = {};
                }
            });
            setMemberAvailabilities(prev => ({ ...initial, ...prev }));
        }
    }, [isAdmin, epreuves]);

    const toggleMemberSlot = (epreuveId: string, key: string) => {
        setMemberAvailabilities(prev => ({
            ...prev,
            [epreuveId]: {
                ...(prev[epreuveId] || {}),
                [key]: !(prev[epreuveId]?.[key] || false),
            },
        }));
    };

    const resetMemberSlots = (epreuveId: string) => {
        setMemberAvailabilities(prev => ({
            ...prev,
            [epreuveId]: {},
        }));
    };

    const handleSaveMemberAvailability = async (epreuveId: string) => {
        try {
            const slots = memberAvailabilities[epreuveId] || {};
            const selected = Object.entries(slots).filter(([, v]) => v).map(([k]) => {
                const [day, time] = k.split('-');
                const dayMap: Record<string, string> = {
                    'Lun': 'mon', 'Mar': 'tue', 'Mer': 'wed', 'Jeu': 'thu', 'Ven': 'fri',
                };
                const hour = parseInt(time);
                return {
                    weekday: dayMap[day] || day.toLowerCase(),
                    startTime: `${hour.toString().padStart(2, '0')}:00`,
                    endTime: `${(hour + 1).toString().padStart(2, '0')}:00`,
                };
            });
            await api.put('/availability', { availabilities: selected });
            toast('Disponibilites enregistrees !', 'success');
        } catch (e) {
            console.error('Erreur sauvegarde:', e);
            toast('Erreur lors de la sauvegarde', 'error');
        }
    };

    // Admin handlers
    const handleOuvrirSaisieDispos = async () => {
        try {
            await api.put('/settings', { saisie_dispos_ouverte: 'true' });
            setSaisiOuverte(true);
            toast('Saisie des disponibilites ouverte', 'success');
        } catch {
            toast('Erreur', 'error');
        }
    };

    const handleFermerSaisieDispos = async () => {
        try {
            await api.put('/settings', { saisie_dispos_ouverte: 'false' });
            setSaisiOuverte(false);
            toast('Saisie des disponibilites fermee', 'success');
        } catch {
            toast('Erreur', 'error');
        }
    };

    const handleOuvrirInscriptions = async () => {
        if (!selectedEpreuveId) return;
        try {
            // Publish all draft slots for this epreuve
            const res = await api.get('/slots/all');
            const draftSlots = (res.data || [])
                .filter((s: any) => (s.epreuve_id === selectedEpreuveId || s.epreuveId === selectedEpreuveId) && s.status === 'draft');
            if (draftSlots.length > 0) {
                await api.put('/slots/status/bulk', {
                    slotIds: draftSlots.map((s: any) => s.id),
                    status: 'published',
                });
            }
            setInscriptionsOuvertes(true);
            toast(`${draftSlots.length} creneau(x) ouverts aux inscriptions`, 'success');
            fetchSlotData();
        } catch {
            toast('Erreur ouverture inscriptions', 'error');
        }
    };

    const handleFermerInscriptions = async () => {
        if (!selectedEpreuveId) return;
        try {
            const res = await api.get('/slots/all');
            const publishedSlots = (res.data || [])
                .filter((s: any) => (s.epreuve_id === selectedEpreuveId || s.epreuveId === selectedEpreuveId) && s.status === 'published');
            if (publishedSlots.length > 0) {
                await api.put('/slots/status/bulk', {
                    slotIds: publishedSlots.map((s: any) => s.id),
                    status: 'closed',
                });
            }
            setInscriptionsOuvertes(false);
            toast(`${publishedSlots.length} creneau(x) fermes`, 'success');
            fetchSlotData();
        } catch {
            toast('Erreur fermeture inscriptions', 'error');
        }
    };

    const handleRelancer = () => {
        toast('Fonctionnalite de relance par email a configurer (necessite un service email)', 'info');
    };

    const [repartitionLoading, setRepartitionLoading] = useState(false);
    const [repartitionResult, setRepartitionResult] = useState<any>(null);

    const handleRepartir = async () => {
        if (!selectedEpreuveId) {
            toast('Selectionnez une epreuve', 'error');
            return;
        }

        setRepartitionLoading(true);
        setRepartitionResult(null);

        try {
            const res = await api.post('/slots/auto-assign', {
                epreuveId: selectedEpreuveId,
                sallesParCreneau,
                evalParSalle,
            });

            const data = res.data;
            setRepartitionResult(data);

            if (data.summary.totalSlots === 0) {
                toast('Aucun creneau avec suffisamment d\'evaluateurs disponibles', 'info');
            } else {
                toast(
                    `Repartition terminee : ${data.summary.totalSlots} salle(s) creee(s), ${data.summary.totalAssignments} affectation(s)`,
                    'success'
                );
            }

            // Refresh slot data
            fetchSlotData();
            fetchAvailabilityData();
        } catch (e) {
            console.error('Erreur repartition:', e);
            toast('Erreur lors de la repartition automatique', 'error');
        } finally {
            setRepartitionLoading(false);
        }
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '400px' }}>
                <p className="text-gray-400 text-sm">Chargement...</p>
            </div>
        );
    }

    // ===================== ADMIN VIEW =====================
    if (isAdmin) {
        const capacite = sallesParCreneau * evalParSalle;

        return (
            <div className="flex flex-col gap-6 p-6">
                {/* Header */}
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Dispos &amp; Inscriptions</h1>
                    <p className="text-sm text-gray-500 mt-1">Logistique des creneaux</p>
                </div>

                {/* Epreuve selector */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Epreuve</label>
                    <select
                        className="w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        value={selectedEpreuveId}
                        onChange={e => setSelectedEpreuveId(e.target.value)}
                    >
                        {epreuves.map(ep => (
                            <option key={ep.id} value={ep.id}>{ep.name} — {ep.type} (Tour {ep.tour})</option>
                        ))}
                    </select>
                </div>

                {/* Card: Dispos evaluateurs */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                    <div className="px-5 py-4 border-b border-gray-100">
                        <h2 className="text-base font-semibold text-gray-900">⏰ Dispos evaluateurs</h2>
                    </div>
                    <div className="p-5">
                        {/* Availability grid */}
                        <div className="overflow-x-auto">
                            <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(5, 1fr)', gap: '4px' }}>
                                {/* Header row */}
                                <div />
                                {DAYS.map(day => (
                                    <div key={day} className="text-center text-xs font-semibold text-gray-600 py-2">{day}</div>
                                ))}

                                {/* Time slot rows */}
                                {TIME_SLOTS.map(slot => (
                                    <div key={`row-${slot}`} style={{ display: 'contents' }}>
                                        <div className="text-xs text-gray-500 font-medium flex items-center justify-end pr-2">{slot}</div>
                                        {DAYS.map(day => {
                                            const key = `${day}-${slot}`;
                                            const count = availabilityData[key] || 0;
                                            return (
                                                <div
                                                    key={key}
                                                    style={{
                                                        padding: '6px 3px',
                                                        borderRadius: '5px',
                                                        border: `1.5px solid ${getAvailBorder(count)}`,
                                                        backgroundColor: getAvailBg(count),
                                                        textAlign: 'center',
                                                        fontSize: '12px',
                                                        cursor: 'default',
                                                    }}
                                                >
                                                    <span style={{ fontWeight: 600 }}>👤{count}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Legend */}
                        <div className="flex gap-4 mt-4 text-xs text-gray-500">
                            <div className="flex items-center gap-1.5">
                                <span style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', display: 'inline-block' }} />
                                3+ dispos
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: '#FEF9C3', border: '1px solid #FDE68A', display: 'inline-block' }} />
                                2 dispos
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: '#FFF0F3', border: '1px solid #FECDD3', display: 'inline-block' }} />
                                0-1 dispo
                            </div>
                        </div>

                        {/* Buttons */}
                        <div className="flex gap-3 mt-5">
                            <button
                                onClick={handleOuvrirSaisieDispos}
                                disabled={saisiOuverte}
                                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                            >
                                {saisiOuverte ? 'Saisie ouverte' : 'Ouvrir saisie dispos'}
                            </button>
                            <button
                                onClick={handleFermerSaisieDispos}
                                disabled={!saisiOuverte}
                                className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors border border-gray-200 disabled:opacity-50"
                            >
                                Fermer saisie
                            </button>
                        </div>
                    </div>
                </div>

                {/* Card: Salles & Jury */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                    <div className="px-5 py-4 border-b border-gray-100">
                        <h2 className="text-base font-semibold text-gray-900">🏫 Salles &amp; Jury</h2>
                    </div>
                    <div className="p-5">
                        <div className="grid grid-cols-2 gap-4 max-w-md">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Salles / creneau</label>
                                <input
                                    type="number"
                                    min={1}
                                    value={sallesParCreneau}
                                    onChange={e => setSallesParCreneau(parseInt(e.target.value) || 1)}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Evaluateurs / salle</label>
                                <input
                                    type="number"
                                    min={1}
                                    value={evalParSalle}
                                    onChange={e => setEvalParSalle(parseInt(e.target.value) || 1)}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                        </div>

                        <p className="text-sm text-gray-500 mt-3">
                            Capacite : <span className="font-semibold text-gray-800">{capacite} evaluateurs</span> necessaires par creneau ({sallesParCreneau} salles x {evalParSalle} eval./salle)
                        </p>

                        <div className="mt-4">
                            <button
                                onClick={handleRepartir}
                                disabled={repartitionLoading}
                                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                            >
                                {repartitionLoading ? 'Repartition en cours...' : 'Repartir les evaluateurs'}
                            </button>
                        </div>

                        {/* Repartition results */}
                        {repartitionResult && repartitionResult.assignments?.length > 0 && (
                            <div className="mt-5 border-t border-gray-100 pt-4">
                                <h3 className="text-sm font-semibold text-gray-700 mb-3">Resultat de la repartition</h3>
                                <div className="space-y-2">
                                    {repartitionResult.assignments.map((a: any, idx: number) => (
                                        <div key={idx} className="flex items-start gap-3 px-3 py-2 bg-gray-50 rounded-lg text-sm">
                                            <span className="font-medium text-gray-700 whitespace-nowrap">{a.room}</span>
                                            <span className="text-gray-400">|</span>
                                            <span className="text-gray-600">{a.time}</span>
                                            <span className="text-gray-400">|</span>
                                            <span className="text-gray-500">{a.members.join(', ')}</span>
                                        </div>
                                    ))}
                                </div>
                                <p className="text-xs text-gray-400 mt-2">
                                    {repartitionResult.summary.totalSlots} salle(s) &bull; {repartitionResult.summary.totalAssignments} affectation(s) &bull; Statut : brouillon
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Card: Inscriptions candidats */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                    <div className="px-5 py-4 border-b border-gray-100">
                        <h2 className="text-base font-semibold text-gray-900">📋 Inscriptions candidats</h2>
                    </div>
                    <div className="p-5">
                        {/* Buttons */}
                        <div className="flex gap-3 mb-5">
                            <button
                                onClick={handleOuvrirInscriptions}
                                disabled={inscriptionsOuvertes}
                                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                            >
                                {inscriptionsOuvertes ? 'Inscriptions ouvertes' : 'Ouvrir inscriptions'}
                            </button>
                            <button
                                onClick={handleFermerInscriptions}
                                disabled={!inscriptionsOuvertes}
                                className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors border border-gray-200 disabled:opacity-50"
                            >
                                Fermer
                            </button>
                            <button
                                onClick={handleRelancer}
                                className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors border border-gray-200"
                            >
                                Relancer non-inscrits
                            </button>
                        </div>

                        {/* Inscriptions table */}
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead>
                                    <tr className="border-b border-gray-200">
                                        <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Creneau</th>
                                        <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Inscrits</th>
                                        <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Capacite</th>
                                        <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Statut</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {inscriptionData.map((row, idx) => {
                                        const badge = getStatusBadge(row.statut);
                                        return (
                                            <tr key={idx} className="hover:bg-gray-50">
                                                <td className="px-3 py-2.5 text-sm text-gray-800">{row.creneau}</td>
                                                <td className="px-3 py-2.5 text-sm font-medium text-gray-800">{row.inscrits}</td>
                                                <td className="px-3 py-2.5 text-sm text-gray-600">{row.capacite}</td>
                                                <td className="px-3 py-2.5">
                                                    <span
                                                        style={{
                                                            backgroundColor: badge.bg,
                                                            color: badge.text,
                                                            border: `1px solid ${badge.border}`,
                                                            padding: '2px 10px',
                                                            borderRadius: '9999px',
                                                            fontSize: '12px',
                                                            fontWeight: 600,
                                                        }}
                                                    >
                                                        {row.statut}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {inscriptionData.length === 0 && (
                                        <tr>
                                            <td colSpan={4} className="px-3 py-8 text-center text-gray-400 text-sm">
                                                Aucun creneau pour cette epreuve
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ===================== MEMBER VIEW =====================
    return (
        <div className="flex flex-col gap-6 p-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-gray-900">Mes disponibilites</h1>
                <p className="text-sm text-gray-500 mt-1">Cochez vos creneaux quand la saisie est ouverte par l&apos;admin</p>
            </div>

            {/* Info banner */}
            <div className="flex items-start gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
                <span className="text-base mt-0.5">ℹ️</span>
                <p className="text-sm text-blue-800">La saisie est activee uniquement pendant la periode definie par l&apos;admin.</p>
            </div>

            {/* Epreuve cards with availability grids */}
            {epreuves.map(ep => {
                const epAvail = memberAvailabilities[ep.id] || {};
                const selectedCount = Object.values(epAvail).filter(Boolean).length;

                return (
                    <div key={ep.id} className="bg-white rounded-xl border border-gray-200 shadow-sm">
                        <div className="px-5 py-4 border-b border-gray-100">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h2 className="text-base font-semibold text-gray-900">{ep.name}</h2>
                                <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium border border-blue-200">
                                    {ep.type}
                                </span>
                                <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium border border-gray-200">
                                    Tour {ep.tour}
                                </span>
                            </div>
                        </div>
                        <div className="p-5">
                            {/* Availability grid */}
                            <div className="overflow-x-auto">
                                <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(5, 1fr)', gap: '4px' }}>
                                    {/* Header row */}
                                    <div />
                                    {DAYS.map(day => (
                                        <div key={day} className="text-center text-xs font-semibold text-gray-600 py-2">{day}</div>
                                    ))}

                                    {/* Time slot rows */}
                                    {TIME_SLOTS.map(slot => (
                                        <div key={`row-${ep.id}-${slot}`} style={{ display: 'contents' }}>
                                            <div className="text-xs text-gray-500 font-medium flex items-center justify-end pr-2">{slot}</div>
                                            {DAYS.map(day => {
                                                const key = `${day}-${slot}`;
                                                const isSelected = epAvail[key] || false;
                                                return (
                                                    <div
                                                        key={`${ep.id}-${key}`}
                                                        onClick={() => toggleMemberSlot(ep.id, key)}
                                                        style={{
                                                            padding: '6px 3px',
                                                            borderRadius: '5px',
                                                            border: isSelected ? '1.5px solid #2563EB' : '1.5px solid #E5E7EB',
                                                            backgroundColor: isSelected ? '#EFF6FF' : '#FFFFFF',
                                                            textAlign: 'center',
                                                            fontSize: '12px',
                                                            cursor: 'pointer',
                                                            fontWeight: isSelected ? 600 : 400,
                                                            color: isSelected ? '#2563EB' : '#9CA3AF',
                                                            userSelect: 'none',
                                                            transition: 'all 0.15s ease',
                                                        }}
                                                    >
                                                        ✓
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Selected count */}
                            <p className="text-xs text-gray-500 mt-3">
                                {selectedCount} creneau{selectedCount > 1 ? 'x' : ''} selectionne{selectedCount > 1 ? 's' : ''}
                            </p>

                            {/* Buttons */}
                            <div className="flex gap-3 mt-4">
                                <button
                                    onClick={() => handleSaveMemberAvailability(ep.id)}
                                    className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                                >
                                    Enregistrer
                                </button>
                                <button
                                    onClick={() => resetMemberSlots(ep.id)}
                                    className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors border border-gray-200"
                                >
                                    Reinitialiser
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })}

            {epreuves.length === 0 && (
                <div className="text-center py-12 text-gray-400 text-sm">
                    Aucune epreuve disponible pour le moment.
                </div>
            )}
        </div>
    );
}
