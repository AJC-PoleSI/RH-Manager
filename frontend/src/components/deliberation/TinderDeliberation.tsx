"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, X, HelpCircle, ChevronLeft, ChevronRight, User, Star, MessageSquare, Award } from 'lucide-react';
import clsx from 'clsx';

interface TinderDeliberationProps {
    candidates: any[];
    selectedTour: number;
    onDecision: (candidateId: string, decision: 'accepted' | 'refused' | 'waiting', prosComment?: string, consComment?: string) => Promise<void>;
    onShowReserve: () => void;
    isAdmin: boolean;
}

export default function TinderDeliberation({ candidates, selectedTour, onDecision, onShowReserve, isAdmin }: TinderDeliberationProps) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [dragX, setDragX] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [isAnimating, setIsAnimating] = useState(false);
    const [animateDirection, setAnimateDirection] = useState<'left' | 'right' | null>(null);
    const [showReserveModal, setShowReserveModal] = useState(false);
    const [prosText, setProsText] = useState('');
    const [consText, setConsText] = useState('');
    const cardRef = useRef<HTMLDivElement>(null);
    const startXRef = useRef(0);
    const SWIPE_THRESHOLD = 120;

    const tourKey = `tour${selectedTour}Status` as string;
    const currentCandidate = candidates[currentIndex];

    // Filter evaluations for the selected tour
    const getEvals = (candidate: any) => {
        return candidate?.evaluations?.filter((e: any) => e.epreuve?.tour === selectedTour) || [];
    };

    const getAvgScore = (evals: any[]) => {
        if (evals.length === 0) return 0;
        let total = 0, count = 0;
        evals.forEach(e => {
            try {
                const scores = typeof e.scores === 'string' ? JSON.parse(e.scores) : e.scores;
                Object.values(scores).forEach((v: any) => { total += Number(v) || 0; count++; });
            } catch { }
        });
        return count > 0 ? (total / count).toFixed(1) : '0';
    };

    const getTotalScore = (eval_: any) => {
        try {
            const scores = typeof eval_.scores === 'string' ? JSON.parse(eval_.scores) : eval_.scores;
            return Object.values(scores).reduce((sum: number, v: any) => sum + (Number(v) || 0), 0);
        } catch { return 0; }
    };

    const getScoreDetails = (eval_: any) => {
        try {
            const scores = typeof eval_.scores === 'string' ? JSON.parse(eval_.scores) : eval_.scores;
            return Object.entries(scores).map(([k, v]) => ({ label: k, value: v }));
        } catch { return []; }
    };

    const getCurrentStatus = () => {
        const delib = currentCandidate?.deliberation;
        if (!delib) return 'pending';
        return delib[tourKey] || 'pending';
    };

    // ---- DRAG / SWIPE HANDLERS ----
    const handleStart = useCallback((clientX: number) => {
        if (!isAdmin || isAnimating) return;
        setIsDragging(true);
        startXRef.current = clientX;
    }, [isAdmin, isAnimating]);

    const handleMove = useCallback((clientX: number) => {
        if (!isDragging) return;
        const dx = clientX - startXRef.current;
        setDragX(dx);
    }, [isDragging]);


    const triggerDecision = useCallback(async (decision: 'accepted' | 'refused' | 'waiting') => {
        if (!currentCandidate || !isAdmin) return;

        if (decision === 'waiting') {
            setShowReserveModal(true);
            return;
        }

        setIsAnimating(true);
        setAnimateDirection(decision === 'accepted' ? 'right' : 'left');

        await onDecision(currentCandidate.id, decision);

        setTimeout(() => {
            setIsAnimating(false);
            setAnimateDirection(null);
            setDragX(0);
            if (currentIndex < candidates.length - 1) {
                setCurrentIndex(prev => prev + 1);
            }
        }, 350);
    }, [currentCandidate, isAdmin, onDecision, currentIndex, candidates.length]);

    const handleEnd = useCallback(() => {
        if (!isDragging) return;
        setIsDragging(false);

        if (Math.abs(dragX) > SWIPE_THRESHOLD) {
            const direction = dragX > 0 ? 'right' : 'left';
            triggerDecision(direction === 'right' ? 'accepted' : 'refused');
        } else {
            setDragX(0);
        }
    }, [isDragging, dragX, triggerDecision]);

    // Mouse
    const onMouseDown = (e: React.MouseEvent) => handleStart(e.clientX);
    const onMouseMove = (e: React.MouseEvent) => handleMove(e.clientX);
    const onMouseUp = () => handleEnd();
    const onMouseLeave = () => { if (isDragging) handleEnd(); };

    // Touch
    const onTouchStart = (e: React.TouchEvent) => handleStart(e.touches[0].clientX);
    const onTouchMove = (e: React.TouchEvent) => handleMove(e.touches[0].clientX);
    const onTouchEnd = () => handleEnd();

    const handleReserveSubmit = async () => {
        if (!currentCandidate) return;
        setShowReserveModal(false);
        setIsAnimating(true);

        await onDecision(currentCandidate.id, 'waiting', prosText, consText);
        setProsText('');
        setConsText('');

        setTimeout(() => {
            setIsAnimating(false);
            setDragX(0);
            if (currentIndex < candidates.length - 1) {
                setCurrentIndex(prev => prev + 1);
            }
        }, 350);
    };

    const goBack = () => {
        if (currentIndex > 0) {
            setCurrentIndex(prev => prev - 1);
        }
    };

    const goForward = () => {
        if (currentIndex < candidates.length - 1) {
            setCurrentIndex(prev => prev + 1);
        }
    };

    // Completed all candidates
    const allDone = currentIndex >= candidates.length;
    const processedCount = candidates.filter(c => {
        const s = c.deliberation?.[tourKey];
        return s && s !== 'pending';
    }).length;

    if (candidates.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-96 text-gray-400">
                <User size={64} className="mb-4 opacity-30" />
                <p className="text-lg font-medium">Aucun candidat pour ce tour</p>
            </div>
        );
    }

    if (allDone) {
        return (
            <div className="flex flex-col items-center justify-center h-96 gap-6">
                <div className="text-6xl">🎉</div>
                <h1 className="text-2xl font-semibold text-gray-800">Tous les candidats ont été passés en revue !</h1>
                <p className="text-gray-500">
                    {processedCount} / {candidates.length} candidats délibérés pour le Tour {selectedTour}
                </p>
                <button
                    onClick={onShowReserve}
                    className="px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-bold text-lg shadow-lg transition-all hover:shadow-xl"
                >
                    👀 Voir les réserves
                </button>
            </div>
        );
    }

    const evals = getEvals(currentCandidate);
    const avgScore = getAvgScore(evals);
    const status = getCurrentStatus();

    // Card transform during drag
    const rotation = dragX * 0.08;
    const opacity = Math.max(0, 1 - Math.abs(dragX) / 400);
    const overlayOpacity = Math.min(Math.abs(dragX) / SWIPE_THRESHOLD, 1) * 0.5;
    const cardTransform = animateDirection
        ? `translateX(${animateDirection === 'right' ? 600 : -600}px) rotate(${animateDirection === 'right' ? 30 : -30}deg)`
        : `translateX(${dragX}px) rotate(${rotation}deg)`;

    return (
        <div className="flex flex-col items-center gap-6 select-none">
            {/* Progress */}
            <div className="flex items-center gap-3 text-sm text-gray-500">
                <button onClick={goBack} disabled={currentIndex === 0} className="p-1 hover:bg-gray-100 rounded-full disabled:opacity-30">
                    <ChevronLeft size={20} />
                </button>
                <span className="font-mono font-bold text-gray-700">{currentIndex + 1} / {candidates.length}</span>
                <button onClick={goForward} disabled={currentIndex >= candidates.length - 1} className="p-1 hover:bg-gray-100 rounded-full disabled:opacity-30">
                    <ChevronRight size={20} />
                </button>
                <span className="ml-4 text-xs">
                    ✅ {candidates.filter(c => c.deliberation?.[tourKey] === 'accepted').length} &nbsp;
                    ❌ {candidates.filter(c => c.deliberation?.[tourKey] === 'refused').length} &nbsp;
                    ⏳ {candidates.filter(c => c.deliberation?.[tourKey] === 'waiting').length}
                </span>
            </div>

            {/* Card Area */}
            <div className="relative w-full max-w-xl h-[600px]">
                {/* Accept/Refuse overlays */}
                {dragX > 20 && (
                    <div className="absolute inset-0 rounded-2xl border-4 border-green-400 bg-green-400 z-30 pointer-events-none flex items-center justify-center"
                        style={{ opacity: overlayOpacity }}>
                        <span className="text-white text-5xl font-semibold rotate-[-15deg]">GARDER ✅</span>
                    </div>
                )}
                {dragX < -20 && (
                    <div className="absolute inset-0 rounded-2xl border-4 border-red-400 bg-red-400 z-30 pointer-events-none flex items-center justify-center"
                        style={{ opacity: overlayOpacity }}>
                        <span className="text-white text-5xl font-semibold rotate-[15deg]">REFUSER ❌</span>
                    </div>
                )}

                {/* THE CANDIDATE CARD */}
                <div
                    ref={cardRef}
                    className={clsx(
                        "absolute inset-0 bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden cursor-grab active:cursor-grabbing flex flex-col",
                        isAnimating && "transition-all duration-300 ease-out"
                    )}
                    style={{
                        transform: cardTransform,
                        opacity: isAnimating ? 0 : 1,
                    }}
                    onMouseDown={onMouseDown}
                    onMouseMove={onMouseMove}
                    onMouseUp={onMouseUp}
                    onMouseLeave={onMouseLeave}
                    onTouchStart={onTouchStart}
                    onTouchMove={onTouchMove}
                    onTouchEnd={onTouchEnd}
                >
                    {/* Card Header */}
                    <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-5 text-white">
                        <div className="flex items-center justify-between">
                            <div>
                                <h1 className="text-2xl font-semibold tracking-tight">
                                    {currentCandidate.firstName} {currentCandidate.lastName}
                                </h1>
                                <p className="text-slate-300 text-sm mt-1">{currentCandidate.email}</p>
                                {currentCandidate.phone && (
                                    <p className="text-slate-400 text-xs mt-0.5">{currentCandidate.phone}</p>
                                )}
                            </div>
                            <div className="flex flex-col items-center">
                                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-2xl font-semibold">
                                    {avgScore}
                                </div>
                                <span className="text-[10px] text-slate-400 mt-1">MOY. T{selectedTour}</span>
                            </div>
                        </div>

                        {/* Status badge if already decided */}
                        {status !== 'pending' && (
                            <div className={clsx("mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase",
                                status === 'accepted' && "bg-green-500/20 text-green-300",
                                status === 'refused' && "bg-red-500/20 text-red-300",
                                status === 'waiting' && "bg-orange-500/20 text-orange-300"
                            )}>
                                {status === 'accepted' && <><Check size={12} /> Gardé</>}
                                {status === 'refused' && <><X size={12} /> Refusé</>}
                                {status === 'waiting' && <><HelpCircle size={12} /> Sous-réserve</>}
                            </div>
                        )}
                    </div>

                    {/* Card Body - Scrollable */}
                    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                        {/* Wishes */}
                        {currentCandidate.wishes?.length > 0 && (
                            <div className="flex items-center gap-2 flex-wrap">
                                <Star size={14} className="text-amber-500" />
                                {currentCandidate.wishes.map((w: any, i: number) => (
                                    <span key={`wish-${w.pole}-${w.rank}`} className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 text-xs rounded-full font-medium border border-amber-200">
                                        #{w.rank} {w.pole}
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Internal notes */}
                        {currentCandidate.comments && (
                            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                                <span className="font-bold text-[10px] uppercase block mb-1 text-yellow-600">Note interne</span>
                                {currentCandidate.comments}
                            </div>
                        )}

                        {/* Evaluations */}
                        <div>
                            <h1 className="text-xs font-semibold text-gray-400 uppercase mb-2 flex items-center gap-1.5">
                                <Award size={13} />
                                Évaluations Tour {selectedTour} ({evals.length})
                            </h1>
                            {evals.length === 0 ? (
                                <p className="text-sm text-gray-400 italic">Aucune évaluation pour ce tour</p>
                            ) : (
                                <div className="space-y-3">
                                    {evals.map((e: any, i: number) => {
                                        const details = getScoreDetails(e);
                                        const total = getTotalScore(e);
                                        return (
                                            <div key={`wish-${w.pole}-${w.rank}`} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                                                <div className="flex justify-between items-start mb-1.5">
                                                    <div>
                                                        <span className="font-bold text-gray-800 text-sm">{e.epreuve?.name}</span>
                                                        {e.member?.email && (
                                                            <span className="ml-2 text-[10px] text-gray-400">par {e.member.email.split('@')[0]}</span>
                                                        )}
                                                    </div>
                                                    <span className="bg-slate-800 text-white px-2 py-0.5 rounded font-mono text-xs font-bold">
                                                        {total} pts
                                                    </span>
                                                </div>
                                                <div className="flex flex-wrap gap-1.5 mb-2">
                                                    {details.map((d: any, di: number) => (
                                                        <span key={di} className="bg-white text-gray-600 px-2 py-0.5 rounded text-[11px] border">
                                                            {d.label}: <strong>{d.value}</strong>
                                                        </span>
                                                    ))}
                                                </div>
                                                {e.comment && (
                                                    <div className="bg-white border border-gray-200 rounded p-2 text-xs text-gray-600 italic flex gap-1.5">
                                                        <MessageSquare size={12} className="shrink-0 text-gray-400 mt-0.5" />
                                                        <span>&ldquo;{e.comment}&rdquo;</span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Existing pros/cons if sous-réserve */}
                        {currentCandidate.deliberation?.prosComment && (
                            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
                                <span className="font-bold text-[10px] uppercase block mb-1 text-green-600">Points positifs (+)</span>
                                <span className="text-green-800">{currentCandidate.deliberation.prosComment}</span>
                            </div>
                        )}
                        {currentCandidate.deliberation?.consComment && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
                                <span className="font-bold text-[10px] uppercase block mb-1 text-red-600">Points négatifs (-)</span>
                                <span className="text-red-800">{currentCandidate.deliberation.consComment}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Action buttons */}
            {isAdmin && (
                <div className="flex items-center gap-6">
                    <button
                        onClick={() => triggerDecision('refused')}
                        className="w-16 h-16 rounded-full bg-red-50 hover:bg-red-100 border-2 border-red-200 text-red-500 flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-lg"
                    >
                        <X size={28} />
                    </button>
                    <button
                        onClick={() => triggerDecision('waiting')}
                        className="w-14 h-14 rounded-full bg-orange-50 hover:bg-orange-100 border-2 border-orange-200 text-orange-500 flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-lg"
                    >
                        <HelpCircle size={24} />
                    </button>
                    <button
                        onClick={() => triggerDecision('accepted')}
                        className="w-16 h-16 rounded-full bg-green-50 hover:bg-green-100 border-2 border-green-200 text-green-500 flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-lg"
                    >
                        <Check size={28} />
                    </button>
                </div>
            )}

            {/* See reserve button */}
            <button
                onClick={onShowReserve}
                className="text-sm text-orange-600 hover:text-orange-700 underline underline-offset-2 mt-2"
            >
                👀 Voir les candidats sous-réserve ({candidates.filter(c => c.deliberation?.[tourKey] === 'waiting').length})
            </button>

            {/* Reserve Modal */}
            {showReserveModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowReserveModal(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
                        <h1 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                            <HelpCircle size={20} className="text-orange-500" />
                            Mise sous réserve
                        </h1>
                        <p className="text-sm text-gray-500">
                            Renseignez les points + et - pour <strong>{currentCandidate?.firstName} {currentCandidate?.lastName}</strong>
                        </p>

                        <div>
                            <label className="text-sm font-bold text-green-700 block mb-1">✅ Points positifs</label>
                            <textarea
                                className="w-full border border-green-200 rounded-lg p-3 text-sm focus:ring-2 focus:ring-green-300 focus:border-green-300 outline-none resize-none"
                                rows={3}
                                placeholder="Forces, qualités, atouts..."
                                value={prosText}
                                onChange={e => setProsText(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="text-sm font-bold text-red-700 block mb-1">❌ Points négatifs</label>
                            <textarea
                                className="w-full border border-red-200 rounded-lg p-3 text-sm focus:ring-2 focus:ring-red-300 focus:border-red-300 outline-none resize-none"
                                rows={3}
                                placeholder="Faiblesses, doutes, réserves..."
                                value={consText}
                                onChange={e => setConsText(e.target.value)}
                            />
                        </div>

                        <div className="flex gap-3 pt-2">
                            <button
                                onClick={() => setShowReserveModal(false)}
                                className="flex-1 py-2 rounded-lg border text-sm text-gray-600 hover:bg-gray-50"
                            >
                                Annuler
                            </button>
                            <button
                                onClick={handleReserveSubmit}
                                className="flex-1 py-2 rounded-lg bg-orange-500 text-white font-bold text-sm hover:bg-orange-600 transition-colors"
                            >
                                Mettre sous réserve
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
