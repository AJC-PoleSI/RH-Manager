"use client";

import { useState } from 'react';
import { Check, X, HelpCircle, Star, Award, MessageSquare, ArrowLeft } from 'lucide-react';
import clsx from 'clsx';

interface ReserveViewProps {
    candidates: any[];
    selectedTour: number;
    onDecision: (candidateId: string, decision: 'accepted' | 'refused' | 'waiting', prosComment?: string, consComment?: string) => Promise<void>;
    onBack: () => void;
    isAdmin: boolean;
}

export default function ReserveView({ candidates, selectedTour, onDecision, onBack, isAdmin }: ReserveViewProps) {
    const tourKey = `tour${selectedTour}Status`;
    const reserveCandidates = candidates.filter(c => c.deliberation?.[tourKey] === 'waiting');
    const [edits, setEdits] = useState<Record<string, { pros: string; cons: string }>>({});

    const getEvals = (candidate: any) => {
        return candidate?.evaluations?.filter((e: any) => e.epreuve?.tour === selectedTour) || [];
    };

    const getTotalScore = (eval_: any) => {
        try {
            const scores = typeof eval_.scores === 'string' ? JSON.parse(eval_.scores) : eval_.scores;
            return Object.values(scores).reduce((sum: number, v: any) => sum + (Number(v) || 0), 0);
        } catch { return 0; }
    };

    const getAvgScore = (evals: any[]) => {
        if (evals.length === 0) return '0';
        let total = 0, count = 0;
        evals.forEach(e => {
            try {
                const scores = typeof e.scores === 'string' ? JSON.parse(e.scores) : e.scores;
                Object.values(scores).forEach((v: any) => { total += Number(v) || 0; count++; });
            } catch { }
        });
        return count > 0 ? (total / count).toFixed(1) : '0';
    };

    if (reserveCandidates.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-96 gap-4">
                <div className="text-5xl">✨</div>
                <h2 className="text-xl font-bold text-gray-700">Aucun candidat sous-réserve</h2>
                <p className="text-gray-500 text-sm">Tous les candidats ont été tranchés pour le Tour {selectedTour}</p>
                <button onClick={onBack} className="mt-4 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
                    <ArrowLeft size={16} /> Retour
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">Candidats sous-réserve — Tour {selectedTour}</h2>
                        <p className="text-sm text-gray-500">{reserveCandidates.length} candidat{reserveCandidates.length > 1 ? 's' : ''} à trancher</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 bg-orange-50 px-4 py-2 rounded-lg border border-orange-200">
                    <HelpCircle size={16} className="text-orange-500" />
                    <span className="text-sm font-bold text-orange-700">{reserveCandidates.length}</span>
                </div>
            </div>

            <div className="space-y-4">
                {reserveCandidates.map((c: any) => {
                    const evals = getEvals(c);
                    const avg = getAvgScore(evals);
                    const currentEdits = edits[c.id] || { pros: c.deliberation?.prosComment || '', cons: c.deliberation?.consComment || '' };

                    return (
                        <div key={c.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                            {/* Header */}
                            <div className="bg-gradient-to-r from-orange-50 to-amber-50 px-5 py-4 border-b border-orange-100">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="text-lg font-bold text-gray-800">{c.firstName} {c.lastName}</h3>
                                        <p className="text-sm text-gray-500">{c.email}</p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="text-center">
                                            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center text-white font-bold text-lg">
                                                {avg}
                                            </div>
                                            <span className="text-[9px] text-gray-400 font-medium">MOY</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Wishes */}
                                {c.wishes?.length > 0 && (
                                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                                        <Star size={12} className="text-amber-500" />
                                        {c.wishes.map((w: any, i: number) => (
                                            <span key={i} className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">
                                                #{w.rank} {w.pole}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Body */}
                            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Left: Evaluations */}
                                <div>
                                    <h4 className="text-xs font-bold text-gray-400 uppercase mb-2 flex items-center gap-1">
                                        <Award size={12} /> Évaluations ({evals.length})
                                    </h4>
                                    {evals.length === 0 ? (
                                        <p className="text-xs text-gray-400 italic">Aucune évaluation</p>
                                    ) : (
                                        <div className="space-y-2">
                                            {evals.map((e: any, i: number) => (
                                                <div key={i} className="bg-gray-50 rounded p-2 text-xs border">
                                                    <div className="flex justify-between items-center mb-1">
                                                        <span className="font-bold text-gray-700">{e.epreuve?.name}</span>
                                                        <span className="bg-slate-700 text-white px-1.5 py-0.5 rounded font-mono font-bold text-[10px]">
                                                            {getTotalScore(e)} pts
                                                        </span>
                                                    </div>
                                                    {e.member?.email && (
                                                        <span className="text-[10px] text-gray-400">par {e.member.email.split('@')[0]}</span>
                                                    )}
                                                    {e.comment && (
                                                        <div className="mt-1 text-gray-500 italic flex gap-1">
                                                            <MessageSquare size={10} className="shrink-0 mt-0.5" />
                                                            <span>&ldquo;{e.comment}&rdquo;</span>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Right: Comments +/- */}
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-xs font-bold text-green-700 block mb-1">✅ Points positifs</label>
                                        <textarea
                                            className="w-full border border-green-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-green-200 outline-none resize-none"
                                            rows={3}
                                            value={currentEdits.pros}
                                            onChange={e => setEdits(prev => ({ ...prev, [c.id]: { ...currentEdits, pros: e.target.value } }))}
                                            placeholder="Forces, qualités..."
                                            disabled={!isAdmin}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-red-700 block mb-1">❌ Points négatifs</label>
                                        <textarea
                                            className="w-full border border-red-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-red-200 outline-none resize-none"
                                            rows={3}
                                            value={currentEdits.cons}
                                            onChange={e => setEdits(prev => ({ ...prev, [c.id]: { ...currentEdits, cons: e.target.value } }))}
                                            placeholder="Faiblesses, doutes..."
                                            disabled={!isAdmin}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Action buttons */}
                            {isAdmin && (
                                <div className="border-t border-gray-100 px-5 py-3 flex items-center justify-end gap-3 bg-gray-50/50">
                                    <button
                                        onClick={() => onDecision(c.id, 'refused', currentEdits.pros, currentEdits.cons)}
                                        className="px-4 py-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-sm font-bold transition-colors flex items-center gap-1.5 border border-red-200"
                                    >
                                        <X size={14} /> Refuser
                                    </button>
                                    <button
                                        onClick={() => onDecision(c.id, 'accepted', currentEdits.pros, currentEdits.cons)}
                                        className="px-4 py-2 rounded-lg bg-green-500 hover:bg-green-600 text-white text-sm font-bold transition-colors flex items-center gap-1.5 shadow"
                                    >
                                        <Check size={14} /> Garder
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
