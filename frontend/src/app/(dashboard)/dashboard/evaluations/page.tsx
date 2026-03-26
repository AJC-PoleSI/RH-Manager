"use client";

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';

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

const POLES = ["Système d'information", 'Marketing', 'Développement commercial', 'Audit Qualité', 'Ressource Humaine', 'Trésorerie', 'Bureau - VP', 'Bureau - Président'];

function getScoreTotal(scores: Record<string, number>): number {
    const values = Object.values(scores);
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0);
}

function getScoreAverage(scores: Record<string, number>): number {
    const values = Object.values(scores);
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
            fetchAll();
        } catch (err) {
            console.error(err);
        } finally {
            setCreating(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Supprimer cet evaluateur ?')) return;
        try {
            await api.delete(`/members/${id}`);
            fetchAll();
        } catch (e) {
            console.error(e);
        }
    };

    // Stats
    const evaluateurCount = members.filter(m => !m.isAdmin).length;
    const allScores = evaluations.map(ev => getScoreTotal(ev.scores));
    const avgScore = allScores.length > 0
        ? Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 10) / 10
        : 0;
    const evalCount = evaluations.length;

    // Per-member stats
    const memberEvalCounts: Record<string, number> = {};
    const memberEvalTotals: Record<string, number> = {};
    evaluations.forEach(ev => {
        const mId = ev.member?.id || '';
        memberEvalCounts[mId] = (memberEvalCounts[mId] || 0) + 1;
        memberEvalTotals[mId] = (memberEvalTotals[mId] || 0) + getScoreTotal(ev.scores);
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
            <div>
                <h1 className="text-2xl font-bold text-gray-900">Évaluateurs</h1>
                <p className="text-gray-500 mt-1">Comptes membres JE et notations</p>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white border border-blue-200 rounded-xl p-5">
                    <p className="text-sm text-blue-600 font-medium">Évaluateurs</p>
                    <p className="text-3xl font-bold text-blue-700 mt-1">{evaluateurCount}</p>
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-5">
                    <p className="text-sm text-gray-500 font-medium">Note moyenne</p>
                    <p className="text-3xl font-bold text-gray-700 mt-1">{avgScore}</p>
                </div>
                <div className="bg-white border border-green-200 rounded-xl p-5">
                    <p className="text-sm text-green-600 font-medium">Évaluations saisies</p>
                    <p className="text-3xl font-bold text-green-700 mt-1">{evalCount}</p>
                </div>
            </div>

            {/* Create evaluator form */}
            <div className="bg-white border rounded-xl p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">&#10133; Créer un compte évaluateur</h2>
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
                                placeholder="jean.dupont@essec.edu"
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
                                <th className="px-6 py-3">Mot de passe</th>
                                <th className="px-6 py-3 text-center">Évals</th>
                                <th className="px-6 py-3 text-center">Moy.</th>
                                <th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {members.map(m => {
                                const mEvals = memberEvalCounts[m.id] || 0;
                                const mAvg = mEvals > 0
                                    ? Math.round((memberEvalTotals[m.id] / mEvals) * 10) / 10
                                    : '-';
                                return (
                                    <tr key={m.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-3">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">
                                                    {getInitials(m.firstName, m.lastName)}
                                                </div>
                                                <span className="font-medium text-gray-900">
                                                    {m.firstName || ''} {m.lastName || ''}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-3 text-gray-600">{m.pole || '-'}</td>
                                        <td className="px-6 py-3 text-gray-600">{m.email}</td>
                                        <td className="px-6 py-3">
                                            <code className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">{m.password || '••••••'}</code>
                                        </td>
                                        <td className="px-6 py-3 text-center">{mEvals}</td>
                                        <td className="px-6 py-3 text-center">{mAvg}</td>
                                        <td className="px-6 py-3 text-right space-x-2">
                                            <a href={`/dashboard/members/${m.id}`} className="text-blue-600 hover:underline text-xs font-medium">Modifier</a>
                                            <button
                                                onClick={() => handleDelete(m.id)}
                                                className="text-pink-500 hover:text-pink-700 text-xs font-medium"
                                            >
                                                Suppr.
                                            </button>
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

            {/* Table: Evaluation recap */}
            <div className="bg-white border rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b">
                    <h2 className="text-lg font-semibold text-gray-900">Récap des évaluations données</h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                            <tr>
                                <th className="px-6 py-3">Évaluateur</th>
                                <th className="px-6 py-3">Candidat</th>
                                <th className="px-6 py-3">Épreuve</th>
                                <th className="px-6 py-3 text-center">Tour</th>
                                <th className="px-6 py-3 text-center">Note</th>
                                <th className="px-6 py-3">Commentaire</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {evaluations.map(ev => (
                                <tr key={ev.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-3 font-medium text-gray-900">
                                        {ev.member ? `${ev.member.firstName || ''} ${ev.member.lastName || ''}`.trim() || ev.member.email : '-'}
                                    </td>
                                    <td className="px-6 py-3 text-gray-700">
                                        {ev.candidate.firstName} {ev.candidate.lastName}
                                    </td>
                                    <td className="px-6 py-3 text-gray-600">{ev.epreuve.name}</td>
                                    <td className="px-6 py-3 text-center">{ev.epreuve.tour}</td>
                                    <td className="px-6 py-3 text-center font-bold">{getScoreTotal(ev.scores)}</td>
                                    <td className="px-6 py-3 text-gray-500 italic max-w-xs truncate">{ev.comment || '-'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {evaluations.length === 0 && (
                        <p className="text-center text-gray-400 py-8">Aucune évaluation enregistrée.</p>
                    )}
                </div>
            </div>
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
                const [evalsRes] = await Promise.all([
                    api.get('/evaluations/my-evaluations'),
                ]);
                setEvaluations(evalsRes.data);

                // Try to fetch next candidates to evaluate
                try {
                    const nextRes = await api.get('/evaluations/next-candidates');
                    setNextCandidates(nextRes.data);
                } catch {
                    // Endpoint may not exist yet
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    // Stats
    const totalEvals = evaluations.length;
    const allScores = evaluations.map(ev => getScoreTotal(ev.scores));
    const avgScore = allScores.length > 0
        ? Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 10) / 10
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
                <h1 className="text-2xl font-bold text-gray-900">Mes évaluations</h1>
                <p className="text-gray-500 mt-1">Récapitulatif de vos notations</p>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white border border-blue-200 rounded-xl p-5">
                    <p className="text-sm text-blue-600 font-medium">Total évaluations</p>
                    <p className="text-3xl font-bold text-blue-700 mt-1">{totalEvals}</p>
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-5">
                    <p className="text-sm text-gray-500 font-medium">Note moyenne</p>
                    <p className="text-3xl font-bold text-gray-700 mt-1">{avgScore}</p>
                </div>
            </div>

            {/* History card */}
            <div className="bg-white border rounded-xl p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">&#128221; Historique</h2>
                {evaluations.length === 0 ? (
                    <p className="text-center text-gray-400 py-8">Vous n&apos;avez encore soumis aucune évaluation.</p>
                ) : (
                    <div className="space-y-3">
                        {evaluations.map(ev => (
                            <div key={ev.id} className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                                {/* Avatar */}
                                <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
                                    {getInitials(ev.candidate.firstName, ev.candidate.lastName)}
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-gray-900">
                                        {ev.candidate.firstName} {ev.candidate.lastName}
                                    </p>
                                    <p className="text-sm text-gray-500">
                                        {ev.epreuve.name} &middot; Tour {ev.epreuve.tour}
                                    </p>
                                    {ev.comment && (
                                        <p className="text-sm text-gray-400 italic mt-1 truncate">{ev.comment}</p>
                                    )}
                                </div>

                                {/* Score */}
                                <div className="text-2xl font-bold text-blue-600 flex-shrink-0 px-3">
                                    {getScoreTotal(ev.scores)}
                                </div>

                                {/* Link */}
                                <a
                                    href={`/dashboard/candidates/${ev.candidate.id}`}
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
                <h2 className="text-lg font-semibold text-gray-900 mb-4">&#128284; Prochains candidats</h2>
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
