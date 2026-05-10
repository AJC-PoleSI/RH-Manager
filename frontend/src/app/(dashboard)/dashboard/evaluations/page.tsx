"use client";

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Loader2, X, Pencil, Trash2, UserPlus, BarChart3 } from 'lucide-react';

interface MemberData {
    id: string;
    firstName?: string;
    lastName?: string;
    email: string;
    password?: string;
    pole?: string;
    isAdmin: boolean;
}

interface EvaluationData {
    id: string;
    scores: Record<string, number>;
    comment?: string;
    createdAt: string;
    candidate: { id: string; firstName: string; lastName: string };
    epreuve: { name: string; tour: number; type: string };
    member?: { id: string; firstName?: string; lastName?: string; email: string };
}

const POLES = ["Système d'information", 'Marketing', 'Développement commercial', 'Audit Qualité', 'Ressource Humaine', 'Trésorerie', 'Bureau - VP', 'Bureau - Président', 'Bureau - Trésorier', 'Bureau - Secrétaire générale'];

/**
 * Calcule le total des scores (somme de tous les critères)
 */
function getScoreTotal(scores: Record<string, number | string>): number {
    if (!scores || typeof scores !== 'object') return 0;
    const values = Object.values(scores).map(Number).filter(v => !isNaN(v));
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0);
}

/**
 * Calcule la moyenne par critère (total / nombre de critères)
 */
function getScoreAverage(scores: Record<string, number>): number {
    if (!scores || typeof scores !== 'object') return 0;
    const values = Object.values(scores).filter(v => typeof v === 'number' && !isNaN(v));
    if (values.length === 0) return 0;
    return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10;
}

function getInitials(firstName?: string, lastName?: string): string {
    const f = firstName ? firstName[0].toUpperCase() : '';
    const l = lastName ? lastName[0].toUpperCase() : '';
    return f + l || '?';
}

// ─── ADMIN VIEW ────────────────────────────────────────────────────────────────

function AdminView() {
    const [members, setMembers] = useState<MemberData[]>([]);
    const [evaluations, setEvaluations] = useState<EvaluationData[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [showCreateForm, setShowCreateForm] = useState(false);

    // Edit modal state
    const [editingMember, setEditingMember] = useState<MemberData | null>(null);
    const [editForm, setEditForm] = useState({ firstName: '', lastName: '', email: '', password: '', pole: POLES[0], isAdmin: false });
    const [editSaving, setEditSaving] = useState(false);

    const [form, setForm] = useState({
        firstName: '',
        lastName: '',
        email: '',
        password: '',
        pole: POLES[0],
    });

    const fetchAll = async () => {
        setLoading(true);
        try {
            const [membersRes, evalsRes] = await Promise.all([
                api.get('/members'),
                api.get('/evaluations'),
            ]);
            setMembers(membersRes.data);
            setEvaluations(evalsRes.data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAll();
    }, []);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreating(true);
        try {
            await api.post('/members', form);
            setForm({ firstName: '', lastName: '', email: '', password: '', pole: POLES[0] });
            setShowCreateForm(false);
            fetchAll();
        } catch (err: any) {
            alert(err.response?.data?.error || 'Erreur lors de la création');
        } finally {
            setCreating(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Supprimer cet évaluateur ? Cette action est irréversible.')) return;
        try {
            await api.delete(`/members/${id}`);
            fetchAll();
        } catch (e: any) {
            alert(e.response?.data?.error || 'Erreur lors de la suppression');
        }
    };

    const openEditModal = (m: MemberData) => {
        setEditingMember(m);
        setEditForm({
            firstName: m.firstName || '',
            lastName: m.lastName || '',
            email: m.email,
            password: '',
            pole: m.pole || POLES[0],
            isAdmin: m.isAdmin,
        });
    };

    const handleEditSave = async () => {
        if (!editingMember) return;
        setEditSaving(true);
        try {
            const payload: any = {
                firstName: editForm.firstName,
                lastName: editForm.lastName,
                email: editForm.email,
                pole: editForm.pole,
                isAdmin: editForm.isAdmin,
            };
            if (editForm.password) {
                payload.password = editForm.password;
            }
            await api.put(`/members/${editingMember.id}`, payload);
            setEditingMember(null);
            fetchAll();
        } catch (err: any) {
            alert(err.response?.data?.error || 'Erreur lors de la modification');
        } finally {
            setEditSaving(false);
        }
    };

    // ── Stats ──
    const evaluateurCount = members.filter(m => !m.isAdmin).length;

    // Note moyenne GLOBALE = vraie moyenne des totaux (et plus la moyenne des moyennes qui était mathématiquement fausse)
    const allTotals = evaluations.map(ev => getScoreTotal(ev.scores)).filter(v => v > 0);
    const avgScore = allTotals.length > 0
        ? Math.round((allTotals.reduce((a, b) => a + b, 0) / allTotals.length) * 10) / 10
        : 0;
    const evalCount = evaluations.length;

    // Per-member stats: nombre d'évals + moyenne des totaux
    const memberEvalCounts: Record<string, number> = {};
    const memberEvalAverages: Record<string, number[]> = {};
    evaluations.forEach(ev => {
        const mId = ev.member?.id || '';
        memberEvalCounts[mId] = (memberEvalCounts[mId] || 0) + 1;
        if (!memberEvalAverages[mId]) memberEvalAverages[mId] = [];
        memberEvalAverages[mId].push(getScoreTotal(ev.scores));
    });

    if (loading) {
        return (
            <div className="flex justify-center p-12">
                <Loader2 className="animate-spin text-blue-500" size={32} />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold text-gray-900">Évaluateurs</h1>
                    <p className="text-gray-500 mt-1">Comptes membres JE et notations</p>
                </div>
                <button
                    onClick={() => setShowCreateForm(!showCreateForm)}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors"
                >
                    <UserPlus size={16} />
                    Nouvel évaluateur
                </button>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white border border-blue-200 rounded-xl p-5">
                    <p className="text-sm text-blue-600 font-medium">Évaluateurs</p>
                    <p className="text-3xl font-bold text-blue-700 mt-1">{evaluateurCount}</p>
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-5">
                    <p className="text-sm text-gray-500 font-medium">Note moyenne globale</p>
                    <p className="text-3xl font-bold text-gray-700 mt-1">{avgScore || '-'}</p>
                </div>
                <div className="bg-white border border-green-200 rounded-xl p-5">
                    <p className="text-sm text-green-600 font-medium">Évaluations saisies</p>
                    <p className="text-3xl font-bold text-green-700 mt-1">{evalCount}</p>
                </div>
            </div>

            {/* Create evaluator form (collapsible) */}
            {showCreateForm && (
                <div className="bg-white border rounded-xl p-6 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-gray-900">Créer un compte évaluateur</h2>
                        <button onClick={() => setShowCreateForm(false)} className="text-gray-400 hover:text-gray-600">
                            <X size={20} />
                        </button>
                    </div>
                    <form onSubmit={handleCreate} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-700">Prénom</label>
                                <input
                                    type="text"
                                    required
                                    value={form.firstName}
                                    onChange={e => setForm({ ...form, firstName: e.target.value })}
                                    placeholder="Jean"
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-700">Nom</label>
                                <input
                                    type="text"
                                    required
                                    value={form.lastName}
                                    onChange={e => setForm({ ...form, lastName: e.target.value })}
                                    placeholder="Dupont"
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-700">Email</label>
                                <input
                                    type="email"
                                    required
                                    value={form.email}
                                    onChange={e => setForm({ ...form, email: e.target.value })}
                                    placeholder="jean.dupont@ecole.fr"
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-700">Mot de passe</label>
                                <input
                                    type="text"
                                    required
                                    value={form.password}
                                    onChange={e => setForm({ ...form, password: e.target.value })}
                                    placeholder="MotDePasse123"
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium text-gray-700">Pôle</label>
                            <select
                                value={form.pole}
                                onChange={e => setForm({ ...form, pole: e.target.value })}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                            >
                                {POLES.map(p => (
                                    <option key={p} value={p}>{p}</option>
                                ))}
                            </select>
                        </div>
                        <button
                            type="submit"
                            disabled={creating}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2 rounded-lg text-sm disabled:opacity-50 transition-colors"
                        >
                            {creating ? 'Création...' : 'Créer le compte'}
                        </button>
                    </form>
                </div>
            )}

            {/* Table: All evaluators */}
            <div className="bg-white border rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b">
                    <h2 className="text-lg font-semibold text-gray-900">Tous les évaluateurs</h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                            <tr>
                                <th className="px-6 py-3">Membre</th>
                                <th className="px-6 py-3">Pôle</th>
                                <th className="px-6 py-3">Email</th>
                                <th className="px-6 py-3 text-center">Évals</th>
                                <th className="px-6 py-3 text-center">Note moyenne</th>
                                <th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {members.map(m => {
                                const mEvals = memberEvalCounts[m.id] || 0;
                                const mAvgs = memberEvalAverages[m.id] || [];
                                const mAvg = mAvgs.length > 0
                                    ? Math.round((mAvgs.reduce((a, b) => a + b, 0) / mAvgs.length) * 10) / 10
                                    : null;
                                const displayName = `${m.firstName || ''} ${m.lastName || ''}`.trim();
                                return (
                                    <tr key={m.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-3">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                                    {getInitials(m.firstName, m.lastName)}
                                                </div>
                                                <div>
                                                    <span className="font-medium text-gray-900 block">
                                                        {displayName || <span className="text-gray-400 italic">Sans nom</span>}
                                                    </span>
                                                    {m.isAdmin && (
                                                        <span className="text-[10px] font-semibold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">Admin</span>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-3">
                                            {m.pole ? (
                                                <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-1 rounded-full">{m.pole}</span>
                                            ) : (
                                                <span className="text-gray-400">-</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-3 text-gray-600 text-xs">{m.email}</td>
                                        <td className="px-6 py-3 text-center">
                                            {mEvals > 0 ? (
                                                <span className="inline-flex items-center gap-1 text-green-700 font-semibold">
                                                    <BarChart3 size={12} />
                                                    {mEvals}
                                                </span>
                                            ) : (
                                                <span className="text-gray-400">0</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-3 text-center">
                                            {mAvg !== null ? (
                                                <span className="font-bold text-blue-600">{mAvg}</span>
                                            ) : (
                                                <span className="text-gray-400">-</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-3 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                <button
                                                    onClick={() => openEditModal(m)}
                                                    className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                    title="Modifier"
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                                {!m.isAdmin && (
                                                <button
                                                    onClick={() => handleDelete(m.id)}
                                                    className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                                    title="Supprimer"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {members.length === 0 && (
                        <p className="text-center text-gray-400 py-8">Aucun évaluateur pour le moment.</p>
                    )}
                </div>
            </div>

            {/* Table: Evaluation recap with collective scores */}
            <div className="bg-white border rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b">
                    <h2 className="text-lg font-semibold text-gray-900">Récap des évaluations données</h2>
                    <p className="text-xs text-gray-400 mt-1">Note individuelle de chaque évaluateur + note collective (moyenne automatique)</p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                            <tr>
                                <th className="px-6 py-3">Évaluateur</th>
                                <th className="px-6 py-3">Candidat</th>
                                <th className="px-6 py-3">Épreuve</th>
                                <th className="px-6 py-3 text-center">Tour</th>
                                <th className="px-6 py-3 text-center">Note individuelle</th>
                                <th className="px-6 py-3 text-center">Note collective</th>
                                <th className="px-6 py-3">Commentaire</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {evaluations.map(ev => {
                                // Note collective = moyenne des totaux pour même candidat + même épreuve
                                const sameGroup = evaluations.filter(
                                    e => e.candidate?.id === ev.candidate?.id && e.epreuve?.name === ev.epreuve?.name && e.epreuve?.tour === ev.epreuve?.tour
                                );
                                const groupTotals = sameGroup.map(e => getScoreTotal(e.scores));
                                const collectiveScore = groupTotals.length > 0
                                    ? Math.round((groupTotals.reduce((a, b) => a + b, 0) / groupTotals.length) * 10) / 10
                                    : 0;
                                const groupCount = sameGroup.length;

                                return (
                                    <tr key={ev.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-3 font-medium text-gray-900">
                                            {ev.member ? `${ev.member.firstName || ''} ${ev.member.lastName || ''}`.trim() || ev.member.email : '-'}
                                        </td>
                                        <td className="px-6 py-3 text-gray-700">
                                            {ev.candidate?.firstName || ''} {ev.candidate?.lastName || ''}
                                        </td>
                                        <td className="px-6 py-3 text-gray-600">{ev.epreuve?.name || '-'}</td>
                                        <td className="px-6 py-3 text-center">
                                            <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs font-medium">
                                                T{ev.epreuve?.tour || '?'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-3 text-center font-bold text-blue-600">{getScoreTotal(ev.scores)}</td>
                                        <td className="px-6 py-3 text-center">
                                            <div className="flex items-center justify-center gap-1.5">
                                                <span className="font-bold text-green-700">{collectiveScore}</span>
                                                <span className="text-xs text-gray-400">({groupCount} eval{groupCount > 1 ? 's' : ''})</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-3 text-gray-500 italic max-w-xs truncate">{ev.comment || '-'}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {evaluations.length === 0 && (
                        <p className="text-center text-gray-400 py-8">Aucune évaluation enregistrée.</p>
                    )}
                </div>
            </div>

            {/* ─── Edit Member Modal ─── */}
            {editingMember && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                    <div
                        className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-5">
                            <h1 className="text-lg font-semibold text-gray-900">Modifier l&apos;évaluateur</h3>
                            <button onClick={() => setEditingMember(null)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-gray-700">Prénom</label>
                                    <input
                                        type="text"
                                        value={editForm.firstName}
                                        onChange={e => setEditForm({ ...editForm, firstName: e.target.value })}
                                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-gray-700">Nom</label>
                                    <input
                                        type="text"
                                        value={editForm.lastName}
                                        onChange={e => setEditForm({ ...editForm, lastName: e.target.value })}
                                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-700">Email</label>
                                <input
                                    type="email"
                                    value={editForm.email}
                                    onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-700">Pôle</label>
                                <select
                                    value={editForm.pole}
                                    onChange={e => setEditForm({ ...editForm, pole: e.target.value })}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                >
                                    {POLES.map(p => (
                                        <option key={p} value={p}>{p}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-700">
                                    Nouveau mot de passe <span className="text-gray-400 font-normal">(laisser vide pour conserver)</span>
                                </label>
                                <input
                                    type="text"
                                    value={editForm.password}
                                    onChange={e => setEditForm({ ...editForm, password: e.target.value })}
                                    placeholder="Nouveau mot de passe"
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="editIsAdmin"
                                    checked={editForm.isAdmin}
                                    onChange={e => setEditForm({ ...editForm, isAdmin: e.target.checked })}
                                    className="rounded border-gray-300"
                                />
                                <label htmlFor="editIsAdmin" className="text-sm text-gray-700">Administrateur</label>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
                            <button
                                onClick={() => setEditingMember(null)}
                                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                            >
                                Annuler
                            </button>
                            <button
                                onClick={handleEditSave}
                                disabled={editSaving}
                                className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2 rounded-lg text-sm disabled:opacity-50 transition-colors flex items-center gap-2"
                            >
                                {editSaving && <Loader2 className="animate-spin" size={14} />}
                                Enregistrer
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── MEMBER VIEW ───────────────────────────────────────────────────────────────

function MemberView() {
    const [evaluations, setEvaluations] = useState<EvaluationData[]>([]);
    const [nextCandidates, setNextCandidates] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Utiliser /evaluations directement — l'API scope déjà par member_id pour les non-admin
                const evalsRes = await api.get('/evaluations');
                setEvaluations(Array.isArray(evalsRes.data) ? evalsRes.data : []);

                // Try to fetch next candidates to evaluate
                try {
                    const nextRes = await api.get('/evaluations/next-candidates');
                    setNextCandidates(nextRes.data);
                } catch {
                    // Endpoint may not exist yet
                }
            } catch (e) {
                console.error('Erreur chargement evaluations:', e);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    // Stats — moyenne globale des notes au lieu de moyenne par critère
    const totalEvals = evaluations.length;
    const allTotals = evaluations.map(ev => getScoreTotal(ev.scores)).filter(v => v > 0);
    const avgScore = allTotals.length > 0
        ? Math.round((allTotals.reduce((a, b) => a + b, 0) / allTotals.length) * 10) / 10
        : 0;

    if (loading) {
        return (
            <div className="flex justify-center p-12">
                <Loader2 className="animate-spin text-blue-500" size={32} />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-semibold text-gray-900">Mes évaluations</h1>
                <p className="text-gray-500 mt-1">Récapitulatif de vos notations</p>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white border border-blue-200 rounded-xl p-5">
                    <p className="text-sm text-blue-600 font-medium">Total évaluations</p>
                    <p className="text-3xl font-bold text-blue-700 mt-1">{totalEvals}</p>
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-5">
                    <p className="text-sm text-gray-500 font-medium">Note moyenne globale</p>
                    <p className="text-3xl font-bold text-gray-700 mt-1">{avgScore || '-'}</p>
                </div>
            </div>

            {/* History card */}
            <div className="bg-white border rounded-xl p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Historique</h2>
                {evaluations.length === 0 ? (
                    <p className="text-center text-gray-400 py-8">Vous n&apos;avez encore soumis aucune évaluation.</p>
                ) : (
                    <div className="space-y-3">
                        {evaluations.map(ev => (
                            <div key={ev.id} className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                                {/* Avatar */}
                                <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
                                    {getInitials(ev.candidate?.firstName, ev.candidate?.lastName)}
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-gray-900">
                                        {ev.candidate?.firstName || ''} {ev.candidate?.lastName || ''}
                                    </p>
                                    <p className="text-sm text-gray-500">
                                        {ev.epreuve?.name || ''} &middot; Tour {ev.epreuve?.tour || '?'}
                                    </p>
                                    {ev.comment && (
                                        <p className="text-sm text-gray-400 italic mt-1 truncate">{ev.comment}</p>
                                    )}
                                </div>

                                {/* Score */}
                                <div className="flex flex-col items-center flex-shrink-0 px-3">
                                    <span className="text-2xl font-bold text-blue-600">{getScoreTotal(ev.scores)}</span>
                                    <span className="text-[10px] text-gray-400">total</span>
                                </div>

                                {/* Link */}
                                <a
                                    href={`/dashboard/candidates/${ev.candidate?.id}`}
                                    className="text-blue-600 hover:underline text-sm font-medium flex-shrink-0"
                                >
                                    Voir fiche
                                </a>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Next candidates card */}
            <div className="bg-white border rounded-xl p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Prochains candidats</h2>
                {nextCandidates.length === 0 ? (
                    <p className="text-center text-gray-400 py-8">Aucun candidat en attente d&apos;évaluation.</p>
                ) : (
                    <div className="space-y-3">
                        {nextCandidates.map((c: any, i: number) => (
                            <div key={c.id || i} className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
                                <div className="w-10 h-10 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
                                    {getInitials(c.firstName, c.lastName)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-gray-900">
                                        {c.firstName} {c.lastName}
                                    </p>
                                    {c.epreuve && (
                                        <p className="text-sm text-gray-500">{c.epreuve.name} &middot; Tour {c.epreuve.tour}</p>
                                    )}
                                </div>
                                <a
                                    href={`/dashboard/candidates/${c.id}/evaluate`}
                                    className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                                >
                                    Évaluer
                                </a>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── MAIN PAGE ─────────────────────────────────────────────────────────────────

export default function EvaluationsPage() {
    const { user, role } = useAuth();
    const isAdmin = role === 'member' && user?.isAdmin;

    if (isAdmin) {
        return <AdminView />;
    }

    return <MemberView />;
}
