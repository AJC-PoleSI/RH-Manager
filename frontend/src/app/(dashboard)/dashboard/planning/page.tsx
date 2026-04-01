"use client";

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import CalendarAdminBuilder from '@/components/calendar/CalendarAdminBuilder';
import CalendarMemberBuilder from '@/components/calendar/CalendarMemberBuilder';

interface Epreuve {
    id: string;
    name: string;
    type: string;
    tour: string;
    isCommune: boolean;
    dateDebut?: string;
    dateFin?: string;
    durationMinutes?: number;
    duration_minutes?: number;
    roulementMinutes?: number;
    roulement_minutes?: number;
    nbSalles?: number;
    nb_salles?: number;
    minEvaluatorsPerSalle?: number;
    min_evaluators_per_salle?: number;
    isGroupEpreuve?: boolean;
    groupSize?: number;
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
    const [availabilityDetails, setAvailabilityDetails] = useState<Record<string, any[]>>({});
    const [selectedDispoCell, setSelectedDispoCell] = useState<{ key: string; label: string; members: any[] } | null>(null);
    const [sallesParCreneau, setSallesParCreneau] = useState(2);
    const [evalParSalle, setEvalParSalle] = useState(3);
    const [inscriptionData, setInscriptionData] = useState<{ creneau: string; inscrits: number; capacite: number; statut: string }[]>([]);
    const [saisiOuverte, setSaisiOuverte] = useState(false);
    const [inscriptionsOuvertes, setInscriptionsOuvertes] = useState(false);
    const [existingSlots, setExistingSlots] = useState<any[]>([]);
    const [repartitionLoading, setRepartitionLoading] = useState(false);
    const [repartitionResult, setRepartitionResult] = useState<any>(null);
    const [resetLoading, setResetLoading] = useState(false);
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    // Planning visibility for candidates
    const [planningVisible, setPlanningVisible] = useState(false);
    // Logistique des créneaux (Phase 1 — déplacé depuis le formulaire épreuves)
    const [logNbSalles, setLogNbSalles] = useState(1);
    const [logMinEval, setLogMinEval] = useState(2);
    const [logSaving, setLogSaving] = useState(false);

    // Modale modification créneau
    const [editSlot, setEditSlot] = useState<any>(null);
    const [editRoom, setEditRoom] = useState('');
    const [editSaving, setEditSaving] = useState(false);
    // Tous les membres (pour le sélecteur dans la modale)
    const [allMembers, setAllMembers] = useState<{id: string; email: string; firstName?: string; lastName?: string}[]>([]);

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

    // ══════════════════════════════════════════════════════════════════
    // PERSISTANCE : Charger l'état admin depuis les settings au montage
    // ══════════════════════════════════════════════════════════════════
    const fetchAdminSettings = useCallback(async () => {
        if (!isAdmin) return;
        try {
            const res = await api.get('/settings');
            const saisieVal = res.data?.saisie_dispos_ouverte;
            setSaisiOuverte(saisieVal === 'true' || saisieVal === true);
            const planningVisibleVal = res.data?.planning_visible_candidats;
            setPlanningVisible(planningVisibleVal === 'true' || planningVisibleVal === true);
        } catch {
            console.error('Erreur chargement settings admin');
        }
    }, [isAdmin]);

    // Fetch tous les membres pour le sélecteur dans la modale
    const fetchAllMembers = useCallback(async () => {
        if (!isAdmin) return;
        try {
            const res = await api.get('/members');
            setAllMembers((res.data || []).map((m: any) => ({
                id: m.id,
                email: m.email,
                firstName: m.firstName || m.first_name || '',
                lastName: m.lastName || m.last_name || '',
            })));
        } catch { setAllMembers([]); }
    }, [isAdmin]);

    useEffect(() => {
        fetchAdminSettings();
        fetchAllMembers();
    }, [fetchAdminSettings, fetchAllMembers]);

    // Sync logistique fields when selected epreuve changes
    useEffect(() => {
        if (!selectedEpreuveId) return;
        const ep = epreuves.find((e: any) => e.id === selectedEpreuveId) as any;
        if (ep) {
            setLogNbSalles(ep.nbSalles || ep.nb_salles || 1);
            setLogMinEval(ep.minEvaluatorsPerSalle || ep.min_evaluators_per_salle || 2);
        }
    }, [selectedEpreuveId, epreuves]);

    // Save logistique fields to epreuve
    const handleSaveLogistique = async () => {
        if (!selectedEpreuveId) return;
        setLogSaving(true);
        try {
            await api.put(`/epreuves/${selectedEpreuveId}`, {
                nbSalles: logNbSalles,
                minEvaluatorsPerSalle: logMinEval,
            });
            // Update epreuves list in local state
            setEpreuves((prev: any) => prev.map((ep: any) =>
                ep.id === selectedEpreuveId
                    ? { ...ep, nbSalles: logNbSalles, minEvaluatorsPerSalle: logMinEval }
                    : ep
            ));
            toast('Configuration logistique sauvegardee', 'success');
        } catch (e) {
            console.error('Erreur sauvegarde logistique:', e);
            toast('Erreur lors de la sauvegarde', 'error');
        } finally {
            setLogSaving(false);
        }
    };

    // Fetch real availability data from API
    const fetchAvailabilityData = useCallback(async () => {
        if (!isAdmin || !selectedEpreuveId) return;
        try {
            const res = await api.get('/availability/all');
            const data: Record<string, number> = {};
            const details: Record<string, any[]> = {};
            // Initialize all cells to 0
            DAYS.forEach(day => {
                TIME_SLOTS.forEach(slot => {
                    const key = `${day}-${slot}`;
                    data[key] = 0;
                    details[key] = [];
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
                    details[key].push(a);
                }
            });
            setAvailabilityData(data);
            setAvailabilityDetails(details);
        } catch (e) {
            console.error('Erreur chargement dispos:', e);
            // Fallback to empty data
            const data: Record<string, number> = {};
            const details: Record<string, any[]> = {};
            DAYS.forEach(day => {
                TIME_SLOTS.forEach(slot => {
                    const key = `${day}-${slot}`;
                    data[key] = 0;
                    details[key] = [];
                });
            });
            setAvailabilityData(data);
            setAvailabilityDetails(details);
        }
    }, [isAdmin, selectedEpreuveId]);

    // Fetch slots for inscription data + reconstruct repartition from DB
    const fetchSlotData = useCallback(async () => {
        if (!isAdmin || !selectedEpreuveId) return;
        try {
            const res = await api.get('/slots/all');
            const allSlots = (res.data || []).filter((s: any) => s.epreuve_id === selectedEpreuveId || s.epreuveId === selectedEpreuveId);

            // Stocker les slots bruts pour la répartition persistée
            setExistingSlots(allSlots);

            // Détecter si des inscriptions sont ouvertes (au moins 1 slot published)
            const hasPublished = allSlots.some((s: any) => s.status === 'published');
            setInscriptionsOuvertes(hasPublished);

            // Table d'inscriptions (exclure les drafts pour éviter les fantômes)
            const activeSlots = allSlots.filter((s: any) => s.status !== 'draft' || (s.members?.length > 0));
            const mapped = activeSlots.map((s: any) => {
                const inscrits = s.enrollments?.length || 0;
                const capacite = s.max_candidates || s.maxCandidates || 1;
                const memberCount = s.members?.length || 0;
                let statut = 'Disponible';
                if (inscrits >= capacite) statut = 'Complet';
                else if (inscrits === 0 && memberCount === 0) statut = 'Incomplet';
                return {
                    creneau: `${s.start_time || s.startTime || ''} - ${s.end_time || s.endTime || ''}`,
                    inscrits,
                    capacite,
                    statut,
                };
            });
            setInscriptionData(mapped);

            // Reconstruire repartitionResult depuis les slots en base (persistance)
            if (allSlots.length > 0 && !repartitionResult) {
                const assignments = allSlots
                    .filter((s: any) => s.members?.length > 0)
                    .map((s: any) => ({
                        slotId: s.id,
                        room: s.room || 'Salle',
                        day: s.start_time || '',
                        time: `${s.start_time || ''} - ${s.end_time || ''}`,
                        status: s.status,
                        members: (s.members || []).map((m: any) => m.member?.email || m.email || ''),
                        enrollments: (s.enrollments || []).map((e: any) =>
                            e.candidate ? `${e.candidate.first_name} ${e.candidate.last_name}` : ''
                        ).filter(Boolean),
                    }));

                if (assignments.length > 0) {
                    setRepartitionResult({
                        fromDB: true,
                        summary: {
                            totalSlots: allSlots.length,
                            totalAssignments: assignments.reduce((sum: number, a: any) => sum + a.members.length, 0),
                            sallesParCreneau,
                            evalParSalle,
                            creneauxDisponibles: allSlots.length,
                        },
                        assignments,
                    });
                }
            }
        } catch {
            setInscriptionData([]);
        }
    }, [isAdmin, selectedEpreuveId, repartitionResult, sallesParCreneau, evalParSalle]);

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

    const handlePublierCandidats = async () => {
        try {
            await api.put('/settings', { planning_visible_candidats: 'true', planning_generated: 'true' });
            setPlanningVisible(true);
            toast('Planning visible pour les candidats — ils peuvent maintenant s\'inscrire', 'success');
        } catch {
            toast('Erreur publication candidats', 'error');
        }
    };

    const handleMasquerCandidats = async () => {
        try {
            await api.put('/settings', { planning_visible_candidats: 'false' });
            setPlanningVisible(false);
            toast('Planning masque pour les candidats', 'success');
        } catch {
            toast('Erreur masquage', 'error');
        }
    };

    const handleRelancer = () => {
        toast('Fonctionnalite de relance par email a configurer (necessite un service email)', 'info');
    };

    // ══════════════════════════════════════════════════════════════════
    // Réinitialiser tous les créneaux pour l'épreuve sélectionnée
    // ══════════════════════════════════════════════════════════════════
    const handleResetSlots = async () => {
        if (!selectedEpreuveId) return;
        setResetLoading(true);
        try {
            const slotIds = existingSlots.map((s: any) => s.id);
            if (slotIds.length === 0) {
                toast('Aucun creneau a supprimer', 'info');
                setShowResetConfirm(false);
                setResetLoading(false);
                return;
            }
            await api.post('/slots/reset', { epreuveId: selectedEpreuveId, slotIds });
            setRepartitionResult(null);
            setExistingSlots([]);
            setInscriptionData([]);
            setShowResetConfirm(false);
            toast(`${slotIds.length} creneau(x) supprime(s)`, 'success');
            fetchSlotData();
        } catch (e) {
            console.error('Erreur reset:', e);
            toast('Erreur lors de la reinitialisation', 'error');
        } finally {
            setResetLoading(false);
        }
    };

    // ══════════════════════════════════════════════════════════════════
    // Modale modification créneau : ouvrir / sauvegarder / toggle membre
    // ══════════════════════════════════════════════════════════════════
    const openEditSlot = (slot: any) => {
        setEditSlot(slot);
        setEditRoom(slot.room || '');
    };

    const handleSaveSlot = async () => {
        if (!editSlot) return;
        setEditSaving(true);
        try {
            await api.put(`/slots/${editSlot.id}`, { room: editRoom });
            toast('Creneau mis a jour', 'success');
            setEditSlot(null);
            setRepartitionResult(null); // Force re-fetch from DB
            fetchSlotData();
        } catch {
            toast('Erreur mise a jour', 'error');
        } finally {
            setEditSaving(false);
        }
    };

    const handleToggleMemberOnSlot = async (slotId: string, memberId: string, isAssigned: boolean) => {
        try {
            if (isAssigned) {
                // Retirer le membre
                await api.post('/slots/toggle-member', { slotId, memberId, action: 'remove' });
            } else {
                // Ajouter le membre
                await api.post('/slots/toggle-member', { slotId, memberId, action: 'add' });
            }
            // Re-fetch le slot modifié
            const res = await api.get('/slots/all');
            const updated = (res.data || []).find((s: any) => s.id === slotId);
            if (updated) setEditSlot(updated);
            setRepartitionResult(null);
            fetchSlotData();
        } catch (e: any) {
            toast(e?.response?.data?.error || 'Erreur modification evaluateur', 'error');
        }
    };

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
                        onChange={e => { setSelectedEpreuveId(e.target.value); setRepartitionResult(null); setExistingSlots([]); }}
                    >
                        <option value="">-- Sélectionner une épreuve --</option>
                        {epreuves.map(ep => (
                            <option key={ep.id} value={ep.id}>{ep.name} — {ep.type} (Tour {ep.tour})</option>
                        ))}
                    </select>
                </div>

                {selectedEpreuveId ? (
                    <>
                        {/* ══════════════════════════════════════════════════════════════════
                            LOGISTIQUE DES CRÉNEAUX — nb salles + min évaluateurs
                            (Déplacé depuis le formulaire de création d'épreuve)
                            ══════════════════════════════════════════════════════════════════ */}
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                            <h3 className="text-sm font-semibold text-gray-800 mb-4">⚙️ Logistique des créneaux</h3>
                            <div className="grid grid-cols-2 gap-6 max-w-lg">
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Nombre de salles</label>
                                    <input
                                        type="number"
                                        min={1}
                                        value={logNbSalles}
                                        onChange={e => setLogNbSalles(parseInt(e.target.value) || 1)}
                                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                    <p className="text-[10px] text-gray-400 mt-0.5">Salles en parallèle pour cette épreuve</p>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Min. évaluateurs / salle</label>
                                    <input
                                        type="number"
                                        min={1}
                                        value={logMinEval}
                                        onChange={e => setLogMinEval(parseInt(e.target.value) || 1)}
                                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                    <p className="text-[10px] text-gray-400 mt-0.5">Minimum d&apos;évaluateurs requis par salle</p>
                                </div>
                            </div>
                            <div className="flex justify-end mt-4">
                                <button
                                    onClick={handleSaveLogistique}
                                    disabled={logSaving}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                                >
                                    {logSaving ? 'Sauvegarde...' : 'Sauvegarder la logistique'}
                                </button>
                            </div>
                        </div>

                        <CalendarAdminBuilder
                            selectedEpreuveId={selectedEpreuveId}
                            epreuve={epreuves.find(e => e.id === selectedEpreuveId)}
                            toast={toast}
                            onUpdate={() => { fetchSlotData(); }}
                        />

                        {/* ══════════════════════════════════════════════════════════════════
                            PANNEAU DE CONTRÔLE DU WORKFLOW
                            ══════════════════════════════════════════════════════════════════ */}
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                            <h3 className="text-sm font-semibold text-gray-800 mb-4">🚦 Gestion du workflow</h3>
                            <p className="text-xs text-gray-500 mb-5">Gérez les étapes de publication du planning pour cette épreuve.</p>

                            {/* Workflow steps */}
                            <div className="space-y-4">

                                {/* ÉTAPE 1 — Saisie des disponibilités membres */}
                                <div className={`flex items-center justify-between p-4 rounded-xl border ${
                                    saisiOuverte
                                        ? 'bg-green-50 border-green-200'
                                        : 'bg-gray-50 border-gray-200'
                                }`}>
                                    <div className="flex items-center gap-3">
                                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${
                                            saisiOuverte ? 'bg-green-200 text-green-800' : 'bg-gray-200 text-gray-600'
                                        }`}>1</div>
                                        <div>
                                            <p className="text-sm font-semibold text-gray-800">Saisie des disponibilités</p>
                                            <p className="text-xs text-gray-500">
                                                {saisiOuverte
                                                    ? '✅ Ouverte — les membres peuvent saisir leurs disponibilités'
                                                    : '⏸️ Fermée — les membres ne peuvent pas modifier leurs disponibilités'}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex gap-2 flex-shrink-0">
                                        {saisiOuverte ? (
                                            <button
                                                onClick={handleFermerSaisieDispos}
                                                className="px-4 py-2 text-sm font-medium text-orange-700 bg-orange-100 border border-orange-200 rounded-lg hover:bg-orange-200 transition-colors"
                                            >
                                                Fermer la saisie
                                            </button>
                                        ) : (
                                            <button
                                                onClick={handleOuvrirSaisieDispos}
                                                className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                                            >
                                                Ouvrir la saisie
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* ÉTAPE 2 — Publier les créneaux aux membres */}
                                <div className={`flex items-center justify-between p-4 rounded-xl border ${
                                    inscriptionsOuvertes
                                        ? 'bg-blue-50 border-blue-200'
                                        : 'bg-gray-50 border-gray-200'
                                }`}>
                                    <div className="flex items-center gap-3">
                                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${
                                            inscriptionsOuvertes ? 'bg-blue-200 text-blue-800' : 'bg-gray-200 text-gray-600'
                                        }`}>2</div>
                                        <div>
                                            <p className="text-sm font-semibold text-gray-800">Publication aux membres</p>
                                            <p className="text-xs text-gray-500">
                                                {inscriptionsOuvertes
                                                    ? '✅ Publiés — les membres peuvent voir et s\'inscrire aux créneaux'
                                                    : '⏸️ Non publié — les créneaux sont en brouillon'}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex gap-2 flex-shrink-0">
                                        {inscriptionsOuvertes ? (
                                            <button
                                                onClick={handleFermerInscriptions}
                                                className="px-4 py-2 text-sm font-medium text-orange-700 bg-orange-100 border border-orange-200 rounded-lg hover:bg-orange-200 transition-colors"
                                            >
                                                Fermer les inscriptions
                                            </button>
                                        ) : (
                                            <button
                                                onClick={handleOuvrirInscriptions}
                                                disabled={existingSlots.length === 0}
                                                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                Publier aux membres
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* ÉTAPE 3 — Publier pour les candidats */}
                                <div className={`flex items-center justify-between p-4 rounded-xl border ${
                                    planningVisible
                                        ? 'bg-purple-50 border-purple-200'
                                        : 'bg-gray-50 border-gray-200'
                                }`}>
                                    <div className="flex items-center gap-3">
                                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${
                                            planningVisible ? 'bg-purple-200 text-purple-800' : 'bg-gray-200 text-gray-600'
                                        }`}>3</div>
                                        <div>
                                            <p className="text-sm font-semibold text-gray-800">Visible pour les candidats</p>
                                            <p className="text-xs text-gray-500">
                                                {planningVisible
                                                    ? '✅ Visible — les candidats peuvent voir le planning et s\'inscrire aux créneaux'
                                                    : '⏸️ Masqué — les candidats ne voient pas le planning'}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex gap-2 flex-shrink-0">
                                        {planningVisible ? (
                                            <button
                                                onClick={handleMasquerCandidats}
                                                className="px-4 py-2 text-sm font-medium text-red-700 bg-red-100 border border-red-200 rounded-lg hover:bg-red-200 transition-colors"
                                            >
                                                Masquer le planning
                                            </button>
                                        ) : (
                                            <button
                                                onClick={handlePublierCandidats}
                                                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors"
                                            >
                                                Publier aux candidats
                                            </button>
                                        )}
                                    </div>
                                </div>

                            </div>

                            {/* Résumé rapide */}
                            <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                                <span>{existingSlots.length} créneau(x) créé(s) pour cette épreuve</span>
                                {existingSlots.length > 0 && (
                                    <button
                                        onClick={() => setShowResetConfirm(true)}
                                        className="text-red-500 hover:text-red-700 hover:underline transition-colors"
                                    >
                                        Réinitialiser tous les créneaux
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Confirmation de réinitialisation */}
                        {showResetConfirm && (
                            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-semibold text-red-800">Supprimer tous les créneaux ?</p>
                                    <p className="text-xs text-red-600 mt-0.5">
                                        Cette action supprimera {existingSlots.length} créneau(x), toutes les inscriptions et affectations associées.
                                    </p>
                                </div>
                                <div className="flex gap-2 flex-shrink-0">
                                    <button
                                        onClick={() => setShowResetConfirm(false)}
                                        className="px-3 py-1.5 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                                    >
                                        Annuler
                                    </button>
                                    <button
                                        onClick={handleResetSlots}
                                        disabled={resetLoading}
                                        className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                                    >
                                        {resetLoading ? 'Suppression...' : 'Confirmer la suppression'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center text-gray-500">
                        Veuillez selectionner une epreuve ci-dessus pour configurer son planning.
                    </div>
                )}

                {/* ══════════════════════════════════════════════════════════════════
                    RÈGLE 5 : Événements globaux (visibles par tous les candidats)
                    ══════════════════════════════════════════════════════════════════ */}
                <GlobalEventsAdmin toast={toast} />
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
                <CalendarMemberBuilder 
                    memberId={user?.id || ''}
                    toast={toast}
                    epreuvesConfigured={epreuves}
                />
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

/* ══════════════════════════════════════════════════════════════════════
   COMPOSANT : Événements globaux Admin (RÈGLE 5)
   Permet de créer des événements visibles par TOUS les candidats
   ══════════════════════════════════════════════════════════════════════ */
function GlobalEventsAdmin({ toast }: { toast: (msg: string, type?: any) => void }) {
    const [events, setEvents] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);

    // Form state
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [day, setDay] = useState('');
    const [startTime, setStartTime] = useState('09:00');
    const [endTime, setEndTime] = useState('10:00');

    const fetchEvents = async () => {
        try {
            const res = await api.get('/calendar');
            const globals = (res.data || []).filter((ev: any) => ev.is_global === true);
            setEvents(globals);
        } catch {
            setEvents([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchEvents();
    }, []);

    const handleCreate = async () => {
        if (!title.trim() || !day) {
            toast('Titre et date requis', 'error');
            return;
        }
        setSaving(true);
        try {
            await api.post('/calendar', {
                title: title.trim(),
                description: description.trim() || null,
                day,
                start_time: startTime,
                end_time: endTime,
                is_global: true,
            });
            toast('Événement global créé et visible par tous les candidats', 'success');
            setTitle('');
            setDescription('');
            setDay('');
            setStartTime('09:00');
            setEndTime('10:00');
            setShowForm(false);
            fetchEvents();
        } catch (err: any) {
            toast(err?.response?.data?.error || 'Erreur création événement', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        setDeleting(id);
        try {
            await api.delete(`/calendar/${id}`);
            toast('Événement supprimé', 'success');
            fetchEvents();
        } catch {
            toast('Erreur suppression', 'error');
        } finally {
            setDeleting(null);
        }
    };

    const formatDateFr = (dateStr: string) => {
        try {
            const d = new Date(dateStr);
            return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
        } catch {
            return dateStr;
        }
    };

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                    <h2 className="text-base font-semibold text-gray-900">📢 Événements globaux</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                        Publiés automatiquement dans le calendrier de tous les candidats
                    </p>
                </div>
                <button
                    onClick={() => setShowForm(!showForm)}
                    className="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                    {showForm ? 'Annuler' : '+ Nouvel événement'}
                </button>
            </div>

            <div className="p-5">
                {/* Formulaire création */}
                {showForm && (
                    <div className="mb-5 p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Titre *</label>
                            <input
                                type="text"
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Ex: Réunion d'information, Date limite de rendu..."
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                            <textarea
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                rows={2}
                                placeholder="Détails de l'événement (optionnel)"
                            />
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                                <input
                                    type="date"
                                    value={day}
                                    onChange={e => setDay(e.target.value)}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Début</label>
                                <input
                                    type="time"
                                    value={startTime}
                                    onChange={e => setStartTime(e.target.value)}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Fin</label>
                                <input
                                    type="time"
                                    value={endTime}
                                    onChange={e => setEndTime(e.target.value)}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <button
                                onClick={handleCreate}
                                disabled={saving}
                                className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                            >
                                {saving ? 'Création...' : 'Publier l\'événement'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Liste des événements globaux */}
                {loading ? (
                    <div className="text-center py-8 text-gray-400 text-sm">Chargement...</div>
                ) : events.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 text-sm">
                        Aucun événement global créé
                    </div>
                ) : (
                    <div className="space-y-2">
                        {events.map((ev: any) => (
                            <div
                                key={ev.id}
                                className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="w-2.5 h-2.5 rounded-full bg-blue-500 flex-shrink-0" />
                                        <span className="text-sm font-semibold text-gray-900 truncate">{ev.title}</span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-0.5 ml-5">
                                        {formatDateFr(ev.day)}
                                        {ev.start_time && ` — ${ev.start_time.slice(0, 5)}`}
                                        {ev.end_time && ` - ${ev.end_time.slice(0, 5)}`}
                                    </p>
                                    {ev.description && (
                                        <p className="text-xs text-gray-400 mt-0.5 ml-5 truncate">{ev.description}</p>
                                    )}
                                </div>
                                <button
                                    onClick={() => handleDelete(ev.id)}
                                    disabled={deleting === ev.id}
                                    className="ml-3 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded transition-colors disabled:opacity-50 flex-shrink-0"
                                >
                                    {deleting === ev.id ? '...' : 'Supprimer'}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
