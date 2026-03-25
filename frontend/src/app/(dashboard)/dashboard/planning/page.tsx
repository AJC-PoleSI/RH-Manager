"use client";

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import api from '@/lib/api';

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
    const isAdmin = user?.isAdmin === true;

    const [epreuves, setEpreuves] = useState<Epreuve[]>([]);
    const [selectedEpreuveId, setSelectedEpreuveId] = useState<string>('');
    const [loading, setLoading] = useState(true);

    // Admin state
    const [availabilityData, setAvailabilityData] = useState<Record<string, number>>({});
    const [sallesParCreneau, setSallesParCreneau] = useState(2);
    const [evalParSalle, setEvalParSalle] = useState(3);
    const [inscriptionData, setInscriptionData] = useState<{ creneau: string; inscrits: number; capacite: number; statut: string }[]>([]);

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
            console.error('Erreur chargement épreuves:', e);
        } finally {
            setLoading(false);
        }
    }, [selectedEpreuveId]);

    useEffect(() => {
        fetchEpreuves();
    }, [fetchEpreuves]);

    // Generate mock availability data for admin view
    useEffect(() => {
        if (isAdmin && selectedEpreuveId) {
            const data: Record<string, number> = {};
            DAYS.forEach(day => {
                TIME_SLOTS.forEach(slot => {
                    const key = `${day}-${slot}`;
                    data[key] = Math.floor(Math.random() * 5);
                });
            });
            setAvailabilityData(data);

            setInscriptionData([
                { creneau: 'Lundi 09h-10h', inscrits: 8, capacite: 8, statut: 'Complet' },
                { creneau: 'Lundi 10h-11h', inscrits: 5, capacite: 8, statut: 'Disponible' },
                { creneau: 'Mardi 09h-10h', inscrits: 3, capacite: 8, statut: 'Incomplet' },
                { creneau: 'Mardi 14h-15h', inscrits: 8, capacite: 8, statut: 'Complet' },
                { creneau: 'Mercredi 09h-10h', inscrits: 6, capacite: 8, statut: 'Disponible' },
            ]);
        }
    }, [isAdmin, selectedEpreuveId]);

    // Initialize member availabilities per épreuve
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
            const selected = Object.entries(slots).filter(([, v]) => v).map(([k]) => k);
            await api.post('/disponibilites', { epreuveId, slots: selected });
            alert('Disponibilités enregistrées !');
        } catch (e) {
            console.error('Erreur sauvegarde:', e);
            alert('Erreur lors de la sauvegarde');
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
                    <p className="text-sm text-gray-500 mt-1">Logistique des créneaux</p>
                </div>

                {/* Épreuve selector */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Épreuve</label>
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

                {/* Card: Dispos évaluateurs */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                    <div className="px-5 py-4 border-b border-gray-100">
                        <h2 className="text-base font-semibold text-gray-900">⏰ Dispos évaluateurs</h2>
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
                                    <>
                                        <div key={`label-${slot}`} className="text-xs text-gray-500 font-medium flex items-center justify-end pr-2">{slot}</div>
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
                                    </>
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
                            <button className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors">
                                Ouvrir saisie dispos
                            </button>
                            <button className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors border border-gray-200">
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
                                <label className="block text-sm font-medium text-gray-700 mb-1">Salles / créneau</label>
                                <input
                                    type="number"
                                    min={1}
                                    value={sallesParCreneau}
                                    onChange={e => setSallesParCreneau(parseInt(e.target.value) || 1)}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Évaluateurs / salle</label>
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
                            Capacité : <span className="font-semibold text-gray-800">{capacite} évaluateurs</span> nécessaires par créneau ({sallesParCreneau} salles × {evalParSalle} éval./salle)
                        </p>

                        <div className="mt-4">
                            <button className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors">
                                Répartir les évaluateurs
                            </button>
                        </div>
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
                            <button className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors">
                                Ouvrir inscriptions
                            </button>
                            <button className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors border border-gray-200">
                                Fermer
                            </button>
                            <button className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors border border-gray-200">
                                Relancer non-inscrits
                            </button>
                        </div>

                        {/* Inscriptions table */}
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead>
                                    <tr className="border-b border-gray-200">
                                        <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Créneau</th>
                                        <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Inscrits</th>
                                        <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Capacité</th>
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
                <h1 className="text-2xl font-bold text-gray-900">Mes disponibilités</h1>
                <p className="text-sm text-gray-500 mt-1">Cochez vos créneaux quand la saisie est ouverte par l&apos;admin</p>
            </div>

            {/* Info banner */}
            <div className="flex items-start gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
                <span className="text-base mt-0.5">ℹ️</span>
                <p className="text-sm text-blue-800">La saisie est activée uniquement pendant la période définie par l&apos;admin.</p>
            </div>

            {/* Épreuve cards with availability grids */}
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
                            {(ep.dateDebut || ep.dateFin) && (
                                <p className="text-xs text-gray-500 mt-1">
                                    {ep.dateDebut && ep.dateFin
                                        ? `Du ${ep.dateDebut} au ${ep.dateFin}`
                                        : ep.dateDebut
                                            ? `À partir du ${ep.dateDebut}`
                                            : `Jusqu&apos;au ${ep.dateFin}`}
                                </p>
                            )}
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
                                        <>
                                            <div key={`label-${ep.id}-${slot}`} className="text-xs text-gray-500 font-medium flex items-center justify-end pr-2">{slot}</div>
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
                                        </>
                                    ))}
                                </div>
                            </div>

                            {/* Selected count */}
                            <p className="text-xs text-gray-500 mt-3">
                                {selectedCount} créneau{selectedCount > 1 ? 'x' : ''} sélectionné{selectedCount > 1 ? 's' : ''}
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
                                    Réinitialiser
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })}

            {epreuves.length === 0 && (
                <div className="text-center py-12 text-gray-400 text-sm">
                    Aucune épreuve disponible pour le moment.
                </div>
            )}
        </div>
    );
}
