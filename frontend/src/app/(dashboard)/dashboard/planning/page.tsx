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

interface MySlot {
    id: string;
    date: string;
    start_time: string;
    end_time: string;
    room: string;
    label: string;
    status: string;
    epreuve?: { name: string; tour: string; type: string };
    enrollments?: { candidate: { id: string; first_name: string; last_name: string } }[];
    members?: { member: { id: string; email: string } }[];
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
    const [saisieOuverteMember, setSaisieOuverteMember] = useState<boolean | null>(null); // null = loading
    const [planningGenerated, setPlanningGenerated] = useState<boolean | null>(null); // null = loading
    const [mySlots, setMySlots] = useState<MySlot[]>([]);
    const [selectedSlot, setSelectedSlot] = useState<MySlot | null>(null); // pour la modale

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

    // Fetch saisie status + planning status for members
    const fetchSaisieStatus = useCallback(async () => {
        if (isAdmin) return;
        try {
            const res = await api.get('/settings');
            const saisieVal = res.data?.saisie_dispos_ouverte;
            const planningVal = res.data?.planning_generated;
            setSaisieOuverteMember(saisieVal === 'true' || saisieVal === true);
            setPlanningGenerated(planningVal === 'true' || planningVal === true);
        } catch {
            setSaisieOuverteMember(false);
            setPlanningGenerated(false);
        }
    }, [isAdmin]);

    // Fetch member's assigned slots (emploi du temps)
    const fetchMySlots = useCallback(async () => {
        if (isAdmin) return;
        try {
            const res = await api.get('/slots/my-slots');
            setMySlots(res.data || []);
        } catch {
            setMySlots([]);
        }
    }, [isAdmin]);

    useEffect(() => {
        fetchSaisieStatus();
    }, [fetchSaisieStatus]);

    // Quand saisie fermée + planning généré → charger les créneaux du membre
    useEffect(() => {
        if (!isAdmin && saisieOuverteMember === false && planningGenerated === true) {
            fetchMySlots();
        }
    }, [isAdmin, saisieOuverteMember, planningGenerated, fetchMySlots]);

    // Helper: get all selected slots across other épreuves (for anti-doublon)
    const getConflictingSlots = (currentEpreuveId: string): Set<string> => {
        const conflicts = new Set<string>();
        Object.entries(memberAvailabilities).forEach(([epId, slots]) => {
            if (epId === currentEpreuveId) return;
            Object.entries(slots).forEach(([key, selected]) => {
                if (selected) conflicts.add(key);
            });
        });
        return conflicts;
    };

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
        // Anti-doublon: si on essaie de cocher et que le créneau est déjà pris sur une autre épreuve
        const currentlySelected = memberAvailabilities[epreuveId]?.[key] || false;
        if (!currentlySelected) {
            const conflicts = getConflictingSlots(epreuveId);
            if (conflicts.has(key)) {
                toast('Ce creneau est deja selectionne sur une autre epreuve. Vous ne pouvez pas etre a deux endroits en meme temps.', 'error');
                return;
            }
        }
        setMemberAvailabilities(prev => ({
            ...prev,
            [epreuveId]: {
                ...(prev[epreuveId] || {}),
                [key]: !currentlySelected,
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

                                {/* Bouton publier le planning pour les membres */}
                                <button
                                    onClick={async () => {
                                        try {
                                            await api.put('/settings', { planning_generated: 'true' });
                                            toast('Planning publie ! Les membres peuvent maintenant consulter leur emploi du temps.', 'success');
                                        } catch {
                                            toast('Erreur lors de la publication du planning', 'error');
                                        }
                                    }}
                                    className="mt-4 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors"
                                >
                                    Publier le planning aux membres
                                </button>
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
    const saisieDisabled = saisieOuverteMember !== true;

    // Helpers pour l'emploi du temps
    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        const jours = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
        const mois = ['jan.', 'fev.', 'mar.', 'avr.', 'mai', 'juin', 'juil.', 'aout', 'sep.', 'oct.', 'nov.', 'dec.'];
        return `${jours[d.getDay()]} ${d.getDate()} ${mois[d.getMonth()]}`;
    };

    const formatTime = (t: string) => {
        if (!t) return '';
        // Accepte "09:00", "09:00:00", "9"
        const parts = t.split(':');
        return `${parts[0].padStart(2, '0')}h${parts[1] ? parts[1] : '00'}`;
    };

    // Grouper les slots par date pour l'affichage calendrier
    const slotsByDate = mySlots.reduce<Record<string, MySlot[]>>((acc, slot) => {
        const dateKey = slot.date?.split('T')[0] || 'unknown';
        if (!acc[dateKey]) acc[dateKey] = [];
        acc[dateKey].push(slot);
        return acc;
    }, {});

    const sortedDates = Object.keys(slotsByDate).sort();

    // Couleurs par épreuve (cycle)
    const epreuveColors = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#EC4899'];
    const getEpreuveColor = (epreuveName: string) => {
        let hash = 0;
        for (let i = 0; i < epreuveName.length; i++) {
            hash = epreuveName.charCodeAt(i) + ((hash << 5) - hash);
        }
        return epreuveColors[Math.abs(hash) % epreuveColors.length];
    };

    // ── ÉTAT 0 : chargement ──
    if (saisieOuverteMember === null || planningGenerated === null) {
        return (
            <div className="flex flex-col gap-6 p-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Mon planning</h1>
                </div>
                <div className="flex items-center justify-center py-20">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
                        <p className="text-sm text-gray-500">Chargement de votre planning...</p>
                    </div>
                </div>
            </div>
        );
    }

    // ── ÉTAT 1 : Saisie ouverte → grille de disponibilités (Étape 1) ──
    if (saisieOuverteMember) {
        return (
            <div className="flex flex-col gap-6 p-6">
                {/* Header */}
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Mes disponibilites</h1>
                    <p className="text-sm text-gray-500 mt-1">Cochez vos creneaux puis cliquez sur &quot;Enregistrer&quot;</p>
                </div>

                {/* Bannière saisie ouverte */}
                <div className="flex items-start gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-xl">
                    <span className="text-base mt-0.5">✅</span>
                    <p className="text-sm text-green-800">La saisie des disponibilites est <strong>ouverte</strong>. Cochez vos creneaux puis cliquez sur &quot;Enregistrer&quot;.</p>
                </div>

                {/* Grilles de disponibilités par épreuve */}
                {epreuves.map(ep => {
                    const epAvail = memberAvailabilities[ep.id] || {};
                    const selectedCount = Object.values(epAvail).filter(Boolean).length;
                    const conflicts = getConflictingSlots(ep.id);

                    return (
                        <div key={ep.id} className="bg-white rounded-xl border border-gray-200 shadow-sm">
                            <div className="px-5 py-4 border-b border-gray-100">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h2 className="text-base font-semibold text-gray-900">{ep.name}</h2>
                                    <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium border border-blue-200">{ep.type}</span>
                                    <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium border border-gray-200">Tour {ep.tour}</span>
                                </div>
                            </div>
                            <div className="p-5">
                                <div className="overflow-x-auto">
                                    <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(5, 1fr)', gap: '4px' }}>
                                        <div />
                                        {DAYS.map(day => (
                                            <div key={day} className="text-center text-xs font-semibold text-gray-600 py-2">{day}</div>
                                        ))}
                                        {TIME_SLOTS.map(slot => (
                                            <div key={`row-${ep.id}-${slot}`} style={{ display: 'contents' }}>
                                                <div className="text-xs text-gray-500 font-medium flex items-center justify-end pr-2">{slot}</div>
                                                {DAYS.map(day => {
                                                    const key = `${day}-${slot}`;
                                                    const isSelected = epAvail[key] || false;
                                                    const isConflict = conflicts.has(key);
                                                    const cellDisabled = isConflict;
                                                    return (
                                                        <div
                                                            key={`${ep.id}-${key}`}
                                                            onClick={() => !cellDisabled && toggleMemberSlot(ep.id, key)}
                                                            title={isConflict ? 'Deja selectionne sur une autre epreuve' : ''}
                                                            style={{
                                                                padding: '6px 3px', borderRadius: '5px',
                                                                border: isSelected ? '1.5px solid #2563EB' : isConflict ? '1.5px solid #FCA5A5' : '1.5px solid #E5E7EB',
                                                                backgroundColor: isSelected ? '#EFF6FF' : isConflict ? '#FEF2F2' : '#FFFFFF',
                                                                textAlign: 'center', fontSize: '12px',
                                                                cursor: cellDisabled ? 'not-allowed' : 'pointer',
                                                                fontWeight: isSelected ? 600 : 400,
                                                                color: isSelected ? '#2563EB' : isConflict ? '#EF4444' : '#9CA3AF',
                                                                userSelect: 'none', transition: 'all 0.15s ease',
                                                            }}
                                                        >
                                                            {isConflict ? '✕' : '✓'}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex gap-4 mt-3 text-xs text-gray-500">
                                    <span>{selectedCount} creneau{selectedCount > 1 ? 'x' : ''} selectionne{selectedCount > 1 ? 's' : ''}</span>
                                    {conflicts.size > 0 && (
                                        <span className="flex items-center gap-1">
                                            <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5', display: 'inline-block' }} />
                                            <span className="text-red-500">Pris sur autre epreuve</span>
                                        </span>
                                    )}
                                </div>
                                <div className="flex gap-3 mt-4">
                                    <button onClick={() => handleSaveMemberAvailability(ep.id)} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors">Enregistrer</button>
                                    <button onClick={() => resetMemberSlots(ep.id)} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors border border-gray-200">Reinitialiser</button>
                                </div>
                            </div>
                        </div>
                    );
                })}

                {epreuves.length === 0 && (
                    <div className="text-center py-12 text-gray-400 text-sm">Aucune epreuve disponible pour le moment.</div>
                )}
            </div>
        );
    }

    // ── ÉTAT 2 : Saisie fermée + planning PAS encore généré → message d'attente ──
    if (!planningGenerated) {
        return (
            <div className="flex flex-col gap-6 p-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Mon planning</h1>
                    <p className="text-sm text-gray-500 mt-1">Emploi du temps de vos evaluations</p>
                </div>

                <div className="flex items-center justify-center py-16">
                    <div className="text-center max-w-md">
                        <div style={{
                            width: 80, height: 80, borderRadius: '50%',
                            background: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            margin: '0 auto 20px',
                            border: '2px solid #BFDBFE',
                        }}>
                            <span style={{ fontSize: 36 }}>📋</span>
                        </div>
                        <h2 className="text-lg font-semibold text-gray-800 mb-2">Planning en cours de creation</h2>
                        <p className="text-sm text-gray-500 leading-relaxed">
                            L&apos;administration est en train de preparer votre planning d&apos;evaluation.
                            Vous recevrez votre emploi du temps des qu&apos;il sera valide et publie.
                        </p>
                        <div className="mt-6 flex items-center justify-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
                            <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0.2s' }} />
                            <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0.4s' }} />
                        </div>
                        <button
                            onClick={fetchSaisieStatus}
                            className="mt-6 px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors border border-gray-200"
                        >
                            Actualiser le statut
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── ÉTAT 3 : Saisie fermée + planning généré → EMPLOI DU TEMPS ──
    return (
        <div className="flex flex-col gap-6 p-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Mon emploi du temps</h1>
                    <p className="text-sm text-gray-500 mt-1">{mySlots.length} creneau{mySlots.length > 1 ? 'x' : ''} d&apos;evaluation assigne{mySlots.length > 1 ? 's' : ''}</p>
                </div>
                <button
                    onClick={fetchMySlots}
                    className="px-3 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm hover:bg-gray-200 transition-colors border border-gray-200"
                >
                    Actualiser
                </button>
            </div>

            {/* Bannière info */}
            <div className="flex items-start gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
                <span className="text-base mt-0.5">📅</span>
                <p className="text-sm text-blue-800">Cliquez sur un creneau pour voir les details : epreuve, salle, candidat et co-evaluateurs.</p>
            </div>

            {/* Emploi du temps par date */}
            {mySlots.length === 0 ? (
                <div className="text-center py-16">
                    <div style={{
                        width: 64, height: 64, borderRadius: '50%',
                        background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 16px',
                    }}>
                        <span style={{ fontSize: 28 }}>📭</span>
                    </div>
                    <p className="text-sm text-gray-500">Aucun creneau ne vous a ete assigne pour le moment.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {sortedDates.map(dateKey => {
                        const daySlots = slotsByDate[dateKey].sort((a, b) =>
                            (a.start_time || '').localeCompare(b.start_time || '')
                        );

                        return (
                            <div key={dateKey} className="bg-white rounded-xl border border-gray-200 shadow-sm">
                                {/* Date header */}
                                <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 rounded-t-xl">
                                    <h2 className="text-sm font-semibold text-gray-700">
                                        {formatDate(dateKey)}
                                    </h2>
                                </div>

                                {/* Slots de cette journée */}
                                <div className="divide-y divide-gray-50">
                                    {daySlots.map(slot => {
                                        const color = getEpreuveColor(slot.epreuve?.name || 'default');
                                        const candidateNames = (slot.enrollments || [])
                                            .map(e => `${e.candidate?.first_name || ''} ${e.candidate?.last_name || ''}`.trim())
                                            .filter(Boolean);

                                        return (
                                            <div
                                                key={slot.id}
                                                onClick={() => setSelectedSlot(slot)}
                                                className="flex items-stretch cursor-pointer hover:bg-gray-50 transition-colors"
                                            >
                                                {/* Barre latérale colorée */}
                                                <div style={{
                                                    width: 4,
                                                    backgroundColor: color,
                                                    borderRadius: '0 4px 4px 0',
                                                    flexShrink: 0,
                                                }} />

                                                <div className="flex-1 px-5 py-4">
                                                    <div className="flex items-start justify-between">
                                                        <div className="flex-1">
                                                            {/* Horaire + épreuve */}
                                                            <div className="flex items-center gap-3 mb-1.5">
                                                                <span className="text-sm font-semibold text-gray-900">
                                                                    {formatTime(slot.start_time)} - {formatTime(slot.end_time)}
                                                                </span>
                                                                <span
                                                                    className="px-2 py-0.5 rounded-full text-xs font-medium"
                                                                    style={{
                                                                        backgroundColor: `${color}15`,
                                                                        color: color,
                                                                        border: `1px solid ${color}40`,
                                                                    }}
                                                                >
                                                                    {slot.epreuve?.name || 'Epreuve'}
                                                                </span>
                                                            </div>

                                                            {/* Salle */}
                                                            <div className="flex items-center gap-4 text-xs text-gray-500">
                                                                <span className="flex items-center gap-1">
                                                                    <span>🏫</span> {slot.room || 'Non definie'}
                                                                </span>

                                                                {/* Candidat(s) */}
                                                                {candidateNames.length > 0 && (
                                                                    <span className="flex items-center gap-1">
                                                                        <span>👤</span> {candidateNames.join(', ')}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* Chevron pour indiquer cliquable */}
                                                        <div className="flex items-center text-gray-300 ml-3">
                                                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                                                                <path d="M7 5L12 10L7 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                                            </svg>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ══════════════ MODALE DE DETAILS ══════════════ */}
            {selectedSlot && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-end"
                    onClick={() => setSelectedSlot(null)}
                >
                    {/* Overlay sombre */}
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

                    {/* Side panel */}
                    <div
                        className="relative w-full max-w-md h-full bg-white shadow-2xl overflow-y-auto"
                        onClick={e => e.stopPropagation()}
                        style={{ animation: 'slideInRight 0.25s ease-out' }}
                    >
                        {/* Header modale */}
                        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
                            <h2 className="text-lg font-semibold text-gray-900">Details du creneau</h2>
                            <button
                                onClick={() => setSelectedSlot(null)}
                                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
                            >
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                                    <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                </svg>
                            </button>
                        </div>

                        <div className="p-6 space-y-6">
                            {/* ── Horaire ── */}
                            <div className="flex items-start gap-4">
                                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                                    <span className="text-lg">🕐</span>
                                </div>
                                <div>
                                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Horaire</p>
                                    <p className="text-base font-semibold text-gray-900">
                                        {formatTime(selectedSlot.start_time)} - {formatTime(selectedSlot.end_time)}
                                    </p>
                                    <p className="text-sm text-gray-500 mt-0.5">
                                        {formatDate(selectedSlot.date)}
                                    </p>
                                </div>
                            </div>

                            {/* ── Épreuve ── */}
                            <div className="flex items-start gap-4">
                                <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
                                    <span className="text-lg">📝</span>
                                </div>
                                <div>
                                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Epreuve</p>
                                    <p className="text-base font-semibold text-gray-900">
                                        {selectedSlot.epreuve?.name || 'Non definie'}
                                    </p>
                                    <div className="flex gap-2 mt-1.5">
                                        {selectedSlot.epreuve?.type && (
                                            <span className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 text-xs font-medium border border-purple-200">
                                                {selectedSlot.epreuve.type}
                                            </span>
                                        )}
                                        {selectedSlot.epreuve?.tour && (
                                            <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium border border-gray-200">
                                                Tour {selectedSlot.epreuve.tour}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* ── Salle ── */}
                            <div className="flex items-start gap-4">
                                <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
                                    <span className="text-lg">🏫</span>
                                </div>
                                <div>
                                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Salle</p>
                                    <p className="text-base font-semibold text-gray-900">
                                        {selectedSlot.room || 'Non definie'}
                                    </p>
                                </div>
                            </div>

                            {/* ── Candidat(s) à évaluer ── */}
                            <div className="flex items-start gap-4">
                                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                                    <span className="text-lg">👤</span>
                                </div>
                                <div className="flex-1">
                                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Candidat(s) a evaluer</p>
                                    {(selectedSlot.enrollments || []).length === 0 ? (
                                        <p className="text-sm text-gray-400 italic">Aucun candidat inscrit sur ce creneau</p>
                                    ) : (
                                        <div className="space-y-2">
                                            {(selectedSlot.enrollments || []).map((enrollment, idx) => (
                                                <div key={idx} className="flex items-center gap-2">
                                                    <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center text-xs font-semibold text-amber-700">
                                                        {(enrollment.candidate?.first_name?.[0] || '?').toUpperCase()}
                                                        {(enrollment.candidate?.last_name?.[0] || '').toUpperCase()}
                                                    </div>
                                                    <span className="text-sm font-medium text-gray-800">
                                                        {enrollment.candidate?.first_name} {enrollment.candidate?.last_name}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* ── Co-évaluateurs ── */}
                            <div className="flex items-start gap-4">
                                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
                                    <span className="text-lg">👥</span>
                                </div>
                                <div className="flex-1">
                                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Co-evaluateur(s)</p>
                                    {(() => {
                                        // Filtrer pour ne montrer que les AUTRES membres (pas soi-même)
                                        const coEvals = (selectedSlot.members || [])
                                            .filter(m => m.member?.id !== user?.id)
                                            .map(m => m.member);

                                        if (coEvals.length === 0) {
                                            return <p className="text-sm text-gray-400 italic">Vous evaluez seul(e) sur ce creneau</p>;
                                        }

                                        return (
                                            <div className="space-y-2">
                                                {coEvals.map((member, idx) => (
                                                    <div key={idx} className="flex items-center gap-2">
                                                        <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-semibold text-indigo-700">
                                                            {(member?.email?.[0] || '?').toUpperCase()}
                                                        </div>
                                                        <span className="text-sm font-medium text-gray-800">
                                                            {member?.email || 'Membre'}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>

                            {/* ── Statut ── */}
                            <div className="flex items-start gap-4">
                                <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center flex-shrink-0">
                                    <span className="text-lg">📊</span>
                                </div>
                                <div>
                                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Statut</p>
                                    <span
                                        className="px-2.5 py-1 rounded-full text-xs font-semibold"
                                        style={
                                            selectedSlot.status === 'ready' || selectedSlot.status === 'published'
                                                ? { backgroundColor: '#DCFCE7', color: '#166534', border: '1px solid #BBF7D0' }
                                                : selectedSlot.status === 'draft'
                                                    ? { backgroundColor: '#FEF9C3', color: '#854D0E', border: '1px solid #FDE68A' }
                                                    : { backgroundColor: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB' }
                                        }
                                    >
                                        {selectedSlot.status === 'ready' ? 'Pret' :
                                         selectedSlot.status === 'published' ? 'Publie' :
                                         selectedSlot.status === 'draft' ? 'Brouillon' :
                                         selectedSlot.status === 'full' ? 'Complet' :
                                         selectedSlot.status || 'Inconnu'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* CSS animation pour le slide-in du panel */}
            <style jsx>{`
                @keyframes slideInRight {
                    from {
                        transform: translateX(100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
            `}</style>
        </div>
    );
}
