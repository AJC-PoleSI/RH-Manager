"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { Loader2, ArrowLeft } from 'lucide-react';

export default function CandidateDetailPage({ params }: { params: { id: string } }) {
    const router = useRouter();
    const [candidate, setCandidate] = useState<any>(null);
    const [evaluations, setEvaluations] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            try {
                const [candRes, evalRes] = await Promise.all([
                    api.get(`/candidates/${params.id}`),
                    api.get(`/evaluations/candidate/${params.id}`),
                ]);
                setCandidate(candRes.data);
                setEvaluations(evalRes.data);
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [params.id]);

    const parseQuestions = (epreuve: any): { q: string; weight: number }[] => {
        if (!epreuve) return [];
        try {
            const raw = epreuve.evaluation_questions;
            if (!raw) return [];
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
            return [];
        }
    };

    const getScoreTotal = (scores: any): number => {
        if (!scores) return 0;
        const parsed = typeof scores === 'string' ? JSON.parse(scores) : scores;
        return Object.values(parsed).reduce((sum: number, v: any) => sum + (Number(v) || 0), 0);
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-[60vh]">
                <Loader2 className="animate-spin text-blue-500" size={32} />
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
                        {candidate.firstName?.[0] || candidate.first_name?.[0] || ''}{candidate.lastName?.[0] || candidate.last_name?.[0] || ''}
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">
                            {candidate.firstName || candidate.first_name} {candidate.lastName || candidate.last_name}
                        </h1>
                        <p className="text-gray-500">{candidate.email}</p>
                        <div className="flex gap-4 mt-1 text-sm text-gray-400">
                            {(candidate.phone) && <span>{candidate.phone}</span>}
                            {(candidate.formation) && <span>{candidate.formation}</span>}
                            {(candidate.date_of_birth || candidate.dateOfBirth) && <span>Né(e) le {candidate.date_of_birth || candidate.dateOfBirth}</span>}
                        </div>
                    </div>
                </div>
                {(candidate.comments) && (
                    <div className="mt-4 p-3 bg-yellow-50 rounded-lg text-sm border border-yellow-100">
                        <span className="font-medium text-yellow-700">Note : </span>{candidate.comments}
                    </div>
                )}
                <div className="mt-4 flex gap-2">
                    <button
                        onClick={() => router.push(`/dashboard/candidates/${params.id}/evaluate`)}
                        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                    >
                        Évaluer ce candidat
                    </button>
                </div>
            </div>

            {/* Evaluations */}
            <div className="bg-white rounded-xl border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-100">
                    <h2 className="text-lg font-semibold text-gray-900">Évaluations ({evaluations.length})</h2>
                </div>
                {evaluations.length === 0 ? (
                    <div className="p-8 text-center text-gray-400">Aucune évaluation pour ce candidat</div>
                ) : (
                    <div className="divide-y divide-gray-100">
                        {evaluations.map((ev: any) => {
                            const questions = parseQuestions(ev.epreuves);
                            const scores = typeof ev.scores === 'string' ? JSON.parse(ev.scores) : ev.scores;
                            return (
                                <div key={ev.id} className="p-5">
                                    <div className="flex items-center justify-between mb-2">
                                        <div>
                                            <span className="font-semibold text-gray-900">{ev.epreuves?.name || 'Épreuve'}</span>
                                            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                                                Tour {ev.epreuves?.tour}
                                            </span>
                                        </div>
                                        <span className="text-2xl font-bold text-blue-600">{getScoreTotal(ev.scores)}</span>
                                    </div>
                                    <div className="text-xs text-gray-500 mb-3">
                                        Évalué par <span className="font-medium text-gray-700">{ev.members?.email || 'Inconnu'}</span>
                                        <span className="mx-2">·</span>
                                        {new Date(ev.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                                    </div>
                                    {questions.length > 0 && (
                                        <div className="space-y-1.5 mb-3">
                                            {questions.map((q: any, idx: number) => (
                                                <div key={idx} className="flex items-center justify-between text-sm">
                                                    <span className="text-gray-600">{q.q || `Critère ${idx + 1}`} <span className="text-xs text-gray-400">(coeff. {q.weight || 1})</span></span>
                                                    <span className="font-semibold text-gray-900 bg-gray-100 px-2 py-0.5 rounded text-xs">{scores[String(idx)] ?? '-'}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {ev.comment && (
                                        <p className="text-sm text-gray-600 bg-gray-50 rounded p-2">
                                            <span className="text-xs font-medium text-gray-400">Commentaire : </span>{ev.comment}
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
