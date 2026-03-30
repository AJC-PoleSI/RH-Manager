"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Loader2, ArrowLeft } from 'lucide-react';

interface EvalMember {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
}

interface Evaluation {
    id: string;
    scores: Record<string, number>;
    scoreTotal: number;
    comment: string;
    createdAt: string;
    epreuve: { id: string; name: string; tour: number; type: string } | null;
    member: EvalMember | null;
}

interface EpreuveGroup {
    epreuve: { id: string; name: string; tour: number; type: string } | null;
    evaluations: Evaluation[];
    collectiveScore: number;
    evaluatorCount: number;
}

export default function CandidateDetailPage({ params }: { params: { id: string } }) {
    const router = useRouter();
    const { user, role } = useAuth();
    const isCandidate = role === 'candidate';

    // Extraire l'id de manière sûre (Next.js 13 = sync, Next.js 15 = Promise)
    const candidateId = typeof params?.id === 'string' ? params.id : '';

    const [candidate, setCandidate] = useState<any>(null);
    const [epreuveGroups, setEpreuveGroups] = useState<EpreuveGroup[]>([]);
    const [allEvals, setAllEvals] = useState<Evaluation[]>([]);
    const [loading, setLoading] = useState(true);
    const [accessDenied, setAccessDenied] = useState(false);

    useEffect(() => {
        if (!candidateId) return;

        const load = async () => {
            try {
                // Fetch candidat
                const candRes = await api.get(`/candidates/${candidateId}`);
                setCandidate(candRes.data);

                // Les candidats ne peuvent pas voir les évaluations
                if (role !== 'candidate') {
                    try {
                        const evalRes = await api.get(`/evaluations/candidate/${candidateId}`);
                        const data = evalRes.data;
                        if (data && data.byEpreuve) {
                            setEpreuveGroups(data.byEpreuve);
                            setAllEvals(data.evaluations || []);
                        } else if (Array.isArray(data)) {
                            setAllEvals(data);
                            setEpreuveGroups([]);
                        }
                    } catch {
                        // Permission denied or error — silently ignore evaluations
                    }
                }
            } catch (e: any) {
                if (e?.response?.status === 403) {
                    setAccessDenied(true);
                }
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [candidateId, role]);

    if (loading) {
        return (
            <div className="flex justify-center items-center h-[60vh]">
                <Loader2 className="animate-spin text-blue-500" size={32} />
            </div>
        );
    }

    if (accessDenied) {
        return (
            <div className="text-center py-16">
                <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
                    <span className="text-3xl">🔒</span>
                </div>
                <h2 className="text-lg font-semibold text-gray-800 mb-2">Acces refuse</h2>
                <p className="text-sm text-gray-500 mb-4">Vous n&apos;avez pas la permission de consulter cette fiche.</p>
                <button onClick={() => router.back()} className="text-blue-600 hover:underline text-sm">Retour</button>
            </div>
        );
    }

    if (!candidate) {
        return (
            <div className="text-center py-12 text-gray-500">
                <p>Candidat introuvable</p>
                <button onClick={() => router.back()} className="mt-4 text-blue-600 hover:underline text-sm">Retour</button>
            </div>
        );
    }

    // Note globale tous tours confondus
    const globalAvg = allEvals.length > 0
        ? Math.round((allEvals.reduce((sum, e) => sum + e.scoreTotal, 0) / allEvals.length) * 10) / 10
        : 0;

    return (
        <div className="space-y-6 max-w-3xl mx-auto">
            {/* Back button */}
            <button
                onClick={() => router.back()}
                className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
                <ArrowLeft size={16} /> Retour
            </button>

            {/* Candidate Header */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-2xl font-bold">
                        {(candidate.firstName?.[0] || candidate.first_name?.[0] || '').toUpperCase()}
                        {(candidate.lastName?.[0] || candidate.last_name?.[0] || '').toUpperCase()}
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">
                            {candidate.firstName || candidate.first_name} {candidate.lastName || candidate.last_name}
                        </h1>
                        <p className="text-gray-500">{candidate.email}</p>
                        <div className="flex gap-4 mt-1 text-sm text-gray-400">
                            {candidate.phone && <span>{candidate.phone}</span>}
                            {candidate.formation && <span>{candidate.formation}</span>}
                            {(candidate.date_of_birth || candidate.dateOfBirth) && (
                                <span>Ne(e) le {candidate.date_of_birth || candidate.dateOfBirth}</span>
                            )}
                        </div>
                    </div>
                </div>
                {/* Notes internes : masquées pour les candidats */}
                {!isCandidate && candidate.comments && (
                    <div className="mt-4 p-3 bg-yellow-50 rounded-lg text-sm border border-yellow-100">
                        <span className="font-medium text-yellow-700">Note interne : </span>{candidate.comments}
                    </div>
                )}
                {/* Bouton évaluer : visible uniquement pour admin et membres */}
                {!isCandidate && (
                    <div className="mt-4 flex gap-2">
                        <button
                            onClick={() => router.push(`/dashboard/candidates/${params.id}/evaluate`)}
                            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                        >
                            Evaluer ce candidat
                        </button>
                    </div>
                )}
            </div>

            {/* Voeux de pôle */}
            {candidate.wishes && candidate.wishes.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                    <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                        Choix de pôle
                    </h2>
                    <div className="flex flex-wrap gap-2">
                        {candidate.wishes.map((w: any, i: number) => (
                            <span
                                key={i}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border ${
                                    i === 0
                                        ? 'bg-yellow-50 text-yellow-800 border-yellow-200'
                                        : i === 1
                                        ? 'bg-gray-50 text-gray-700 border-gray-200'
                                        : 'bg-amber-50 text-amber-700 border-amber-200'
                                }`}
                            >
                                <span className="font-bold text-xs">{w.rank}.</span>
                                {w.pole}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Stats globales : masquées pour les candidats */}
            {!isCandidate && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white border border-blue-200 rounded-xl p-5">
                        <p className="text-sm text-blue-600 font-medium">Evaluations</p>
                        <p className="text-3xl font-bold text-blue-700 mt-1">{allEvals.length}</p>
                    </div>
                    <div className="bg-white border border-green-200 rounded-xl p-5">
                        <p className="text-sm text-green-600 font-medium">Note collective globale</p>
                        <p className="text-3xl font-bold text-green-700 mt-1">{globalAvg}</p>
                    </div>
                    <div className="bg-white border border-purple-200 rounded-xl p-5">
                        <p className="text-sm text-purple-600 font-medium">Epreuves evaluees</p>
                        <p className="text-3xl font-bold text-purple-700 mt-1">{epreuveGroups.length}</p>
                    </div>
                </div>
            )}

            {/* Évaluations groupées par épreuve : masquées pour les candidats */}
            {!isCandidate && epreuveGroups.length === 0 && allEvals.length === 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
                    Aucune evaluation pour ce candidat
                </div>
            )}

            {!isCandidate && epreuveGroups.map((group, gIdx) => (
                <div key={gIdx} className="bg-white rounded-xl border border-gray-200">
                    {/* Header épreuve + note collective */}
                    <div className="px-6 py-4 border-b border-gray-100">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <h2 className="text-lg font-semibold text-gray-900">
                                    {group.epreuve?.name || 'Epreuve'}
                                </h2>
                                {group.epreuve?.type && (
                                    <span className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 text-xs font-medium border border-purple-200">
                                        {group.epreuve.type}
                                    </span>
                                )}
                                {group.epreuve?.tour && (
                                    <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium border border-gray-200">
                                        Tour {group.epreuve.tour}
                                    </span>
                                )}
                            </div>

                            {/* Note collective (moyenne) */}
                            <div className="text-right">
                                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Note collective</p>
                                <div className="flex items-baseline gap-1.5 justify-end">
                                    <span className="text-2xl font-bold text-green-600">{group.collectiveScore}</span>
                                    <span className="text-xs text-gray-400">
                                        (moyenne de {group.evaluatorCount} eval{group.evaluatorCount > 1 ? 's' : ''})
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Notes individuelles par évaluateur */}
                    <div className="divide-y divide-gray-50">
                        {group.evaluations.map((ev, evIdx) => {
                            const memberName = ev.member
                                ? `${ev.member.firstName || ''} ${ev.member.lastName || ''}`.trim() || ev.member.email
                                : 'Evaluateur inconnu';

                            return (
                                <div key={ev.id || evIdx} className="px-6 py-4">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3">
                                            {/* Avatar évaluateur */}
                                            <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                                {(ev.member?.firstName?.[0] || ev.member?.email?.[0] || '?').toUpperCase()}
                                                {(ev.member?.lastName?.[0] || '').toUpperCase()}
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-gray-900">{memberName}</p>
                                                <p className="text-xs text-gray-400">
                                                    {new Date(ev.createdAt).toLocaleDateString('fr-FR', {
                                                        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                                                    })}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Note individuelle */}
                                        <div className="text-right flex-shrink-0">
                                            <p className="text-xs text-gray-400">Note individuelle</p>
                                            <span className="text-xl font-bold text-blue-600">{ev.scoreTotal}</span>
                                        </div>
                                    </div>

                                    {/* Détail des scores par critère */}
                                    {Object.keys(ev.scores || {}).length > 0 && (
                                        <div className="mt-3 ml-12 space-y-1">
                                            {Object.entries(ev.scores).map(([key, value]) => (
                                                <div key={key} className="flex items-center justify-between text-sm">
                                                    <span className="text-gray-500">Critere {parseInt(key) + 1}</span>
                                                    <span className="font-medium text-gray-800 bg-gray-50 px-2.5 py-0.5 rounded text-xs">
                                                        {value}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Commentaire */}
                                    {ev.comment && (
                                        <div className="mt-3 ml-12 p-2.5 bg-gray-50 rounded-lg text-sm text-gray-600">
                                            <span className="text-xs font-medium text-gray-400">Commentaire : </span>
                                            {ev.comment}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}
