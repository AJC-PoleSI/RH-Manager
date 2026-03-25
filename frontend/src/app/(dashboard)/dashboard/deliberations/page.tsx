"use client";

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Check, X, Clock, HelpCircle, LayoutGrid, CreditCard } from 'lucide-react';
import clsx from 'clsx';
import TinderDeliberation from '@/components/deliberation/TinderDeliberation';
import ReserveView from '@/components/deliberation/ReserveView';

type ViewMode = 'tinder' | 'table' | 'reserve';

export default function DeliberationsPage() {
    const { user } = useAuth();
    const isAdmin = user?.isAdmin === true;
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTour, setSelectedTour] = useState(1);
    const [viewMode, setViewMode] = useState<ViewMode>('tinder');

    const loadData = async () => {
        try {
            const res = await api.get('/deliberations');
            setData(Array.isArray(res.data) ? res.data : []);
        } catch (e) {
            console.error(e);
            // Fallback to candidates endpoint
            try {
                const res = await api.get('/candidates?limit=1000');
                const candidates = Array.isArray(res.data) ? res.data : (res.data.data || []);
                setData(candidates);
            } catch { }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadData(); }, []);

    const handleDecision = async (candidateId: string, decision: 'accepted' | 'refused' | 'waiting', prosComment?: string, consComment?: string) => {
        const tourKey = `tour${selectedTour}Status`;
        try {
            const payload: any = { [tourKey]: decision };
            if (prosComment !== undefined) payload.prosComment = prosComment;
            if (consComment !== undefined) payload.consComment = consComment;

            await api.put(`/deliberations/${candidateId}`, payload);

            // Optimistic update
            setData(prev => prev.map(c => {
                if (c.id === candidateId) {
                    return {
                        ...c,
                        deliberation: {
                            ...c.deliberation,
                            [tourKey]: decision,
                            ...(prosComment !== undefined ? { prosComment } : {}),
                            ...(consComment !== undefined ? { consComment } : {}),
                        }
                    };
                }
                return c;
            }));
        } catch (e) {
            console.error("Failed to update deliberation:", e);
        }
    };

    // Stats
    const tourKey = `tour${selectedTour}Status`;
    const stats = {
        total: data.length,
        accepted: data.filter(c => c.deliberation?.[tourKey] === 'accepted').length,
        refused: data.filter(c => c.deliberation?.[tourKey] === 'refused').length,
        waiting: data.filter(c => c.deliberation?.[tourKey] === 'waiting').length,
        pending: data.filter(c => !c.deliberation?.[tourKey] || c.deliberation?.[tourKey] === 'pending').length,
    };

    // ---- TABLE VIEW ----
    const StatusPill = ({ status }: { status: string }) => {
        const colors: any = {
            accepted: 'bg-green-100 text-green-700',
            refused: 'bg-red-100 text-red-700',
            pending: 'bg-gray-100 text-gray-700',
            waiting: 'bg-orange-100 text-orange-700'
        };
        const icon: any = {
            accepted: <Check size={12} />,
            refused: <X size={12} />,
            pending: <Clock size={12} />,
            waiting: <HelpCircle size={12} />
        };
        const s = status || 'pending';
        return (
            <span className={clsx("flex items-center gap-1 px-2 py-1 rounded text-xs font-bold uppercase", colors[s] || colors.pending)}>
                {icon[s]} {s === 'accepted' ? 'Gardé' : s === 'refused' ? 'Refusé' : s === 'waiting' ? 'Réserve' : 'En attente'}
            </span>
        );
    };

    const updateStatus = async (candidateId: string, tourKey: string, newStatus: string) => {
        if (!isAdmin) return;
        try {
            setData(prev => prev.map(item =>
                item.id === candidateId
                    ? { ...item, deliberation: { ...item.deliberation, [tourKey]: newStatus } }
                    : item
            ));
            await api.put(`/deliberations/${candidateId}`, { [tourKey]: newStatus });
        } catch (e) {
            console.error("Failed to update status");
        }
    };

    const renderEvals = (list: any[]) => (
        <div className="flex flex-col gap-2 text-xs py-2">
            {list.length === 0 && <span className="opacity-50 italic">Aucune note</span>}
            {list.map((e, i) => {
                let scoreDetails: string[] = [];
                let scoreTotal = 0;
                try {
                    const scores = typeof e.scores === 'string' ? JSON.parse(e.scores) : e.scores;
                    scoreDetails = Object.entries(scores).map(([k, v]) => `${k}: ${v}`);
                    Object.values(scores).forEach((v: any) => scoreTotal += Number(v) || 0);
                } catch { }
                return (
                    <div key={i} className="bg-white/80 border p-2 rounded shadow-sm">
                        <div className="flex justify-between items-start mb-1">
                            <span className="font-bold text-gray-800">{e.epreuve?.name}</span>
                            <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-mono font-bold text-[10px]">{scoreTotal} pts</span>
                        </div>
                        {e.member?.email && <div className="text-[10px] text-gray-400">par {e.member.email.split('@')[0]}</div>}
                        <div className="flex flex-wrap gap-1 mt-1">
                            {scoreDetails.map((s: string, si: number) => (
                                <span key={si} className="bg-gray-50 text-gray-600 px-1 py-0.5 rounded text-[10px]">{s}</span>
                            ))}
                        </div>
                        {e.comment && (
                            <div className="mt-2 text-gray-600 bg-yellow-50/50 p-1.5 rounded border border-yellow-100 italic">
                                <span className="font-semibold not-italic text-[10px] text-yellow-700 uppercase block mb-0.5">Commentaire</span>
                                &quot;{e.comment}&quot;
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );

    const renderActions = (c: any, tourKey: string, currentStatus: string) => {
        const delib = c.deliberation || {};
        let isDisabled = false;
        if (tourKey === 'tour2Status' && delib.tour1Status === 'refused') isDisabled = true;
        if (tourKey === 'tour3Status' && (delib.tour1Status === 'refused' || delib.tour2Status === 'refused')) isDisabled = true;
        if (!isAdmin) isDisabled = true;

        if (isDisabled && !isAdmin) {
            return <div className="h-full flex items-center justify-center"><StatusPill status={currentStatus} /></div>;
        }
        if (isDisabled) {
            return <div className="h-full flex items-center justify-center text-gray-300">-</div>;
        }

        return (
            <div className="flex flex-col gap-2 items-center justify-center h-full py-2">
                <StatusPill status={currentStatus} />
                <div className="flex gap-1 mt-2">
                    <button onClick={() => updateStatus(c.id, tourKey, 'accepted')}
                        className={clsx("p-1.5 rounded transition-colors", currentStatus === 'accepted' ? "bg-green-500 text-white" : "hover:bg-green-100 text-green-600")} title="Garder">
                        <Check size={16} />
                    </button>
                    <button onClick={() => updateStatus(c.id, tourKey, 'refused')}
                        className={clsx("p-1.5 rounded transition-colors", currentStatus === 'refused' ? "bg-red-500 text-white" : "hover:bg-red-100 text-red-600")} title="Refuser">
                        <X size={16} />
                    </button>
                    <button onClick={() => updateStatus(c.id, tourKey, 'waiting')}
                        className={clsx("p-1.5 rounded transition-colors", currentStatus === 'waiting' ? "bg-orange-500 text-white" : "hover:bg-orange-100 text-orange-600")} title="Sous-réserve">
                        <HelpCircle size={16} />
                    </button>
                </div>
            </div>
        );
    };

    if (loading) return <div className="p-8 text-center text-gray-400">Chargement...</div>;

    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900">Délibérations</h1>
            </div>

            {/* Tour Selector + Stats Bar */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    {/* Tour selector */}
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-500">Tour :</span>
                        {[1, 2, 3].map(t => (
                            <button
                                key={t}
                                onClick={() => setSelectedTour(t)}
                                className={clsx(
                                    "px-4 py-2 rounded-lg text-sm font-bold transition-all",
                                    selectedTour === t
                                        ? "bg-slate-800 text-white shadow-md"
                                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                                )}
                            >
                                Tour {t}
                            </button>
                        ))}
                    </div>

                    {/* View mode toggle */}
                    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                        <button
                            onClick={() => setViewMode('tinder')}
                            className={clsx("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                                viewMode === 'tinder' ? "bg-white shadow text-gray-800" : "text-gray-500 hover:text-gray-700"
                            )}
                        >
                            <CreditCard size={15} /> Délibération
                        </button>
                        <button
                            onClick={() => setViewMode('table')}
                            className={clsx("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                                viewMode === 'table' ? "bg-white shadow text-gray-800" : "text-gray-500 hover:text-gray-700"
                            )}
                        >
                            <LayoutGrid size={15} /> Tableau récap
                        </button>
                    </div>

                    {/* Stats */}
                    <div className="flex items-center gap-3 text-xs">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 rounded-full border border-green-200">
                            <Check size={12} /> <strong>{stats.accepted}</strong> gardés
                        </div>
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 rounded-full border border-red-200">
                            <X size={12} /> <strong>{stats.refused}</strong> refusés
                        </div>
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 text-orange-700 rounded-full border border-orange-200">
                            <HelpCircle size={12} /> <strong>{stats.waiting}</strong> réserves
                        </div>
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 text-gray-600 rounded-full border border-gray-200">
                            <Clock size={12} /> <strong>{stats.pending}</strong> en attente
                        </div>
                    </div>
                </div>
            </div>

            {/* View Content */}
            {viewMode === 'tinder' && (
                <div className="py-4">
                    <TinderDeliberation
                        candidates={data}
                        selectedTour={selectedTour}
                        onDecision={handleDecision}
                        onShowReserve={() => setViewMode('reserve')}
                        isAdmin={isAdmin}
                    />
                </div>
            )}

            {viewMode === 'reserve' && (
                <ReserveView
                    candidates={data}
                    selectedTour={selectedTour}
                    onDecision={handleDecision}
                    onBack={() => setViewMode('tinder')}
                    isAdmin={isAdmin}
                />
            )}

            {viewMode === 'table' && (
                <div className="overflow-x-auto border rounded-lg shadow bg-white">
                    <table className="w-full text-sm text-left border-collapse">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="px-4 py-3 sticky left-0 bg-gray-50 z-20 font-bold border-r shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] min-w-[250px]">Candidat</th>
                                <th className="px-4 py-3 bg-blue-50/50 border-r min-w-[400px]" colSpan={2}>
                                    <div className="font-bold text-blue-900 mb-1 text-center">Tour 1</div>
                                    <div className="flex justify-between text-xs font-normal text-gray-500 px-2 border-t border-blue-100 pt-1">
                                        <span>Évaluations & Notes</span><span>Décision</span>
                                    </div>
                                </th>
                                <th className="px-4 py-3 bg-purple-50/50 border-r min-w-[400px]" colSpan={2}>
                                    <div className="font-bold text-purple-900 mb-1 text-center">Tour 2</div>
                                    <div className="flex justify-between text-xs font-normal text-gray-500 px-2 border-t border-purple-100 pt-1">
                                        <span>Évaluations & Notes</span><span>Décision</span>
                                    </div>
                                </th>
                                <th className="px-4 py-3 bg-orange-50/50 border-r min-w-[400px]" colSpan={2}>
                                    <div className="font-bold text-orange-900 mb-1 text-center">Tour 3</div>
                                    <div className="flex justify-between text-xs font-normal text-gray-500 px-2 border-t border-orange-100 pt-1">
                                        <span>Évaluations & Notes</span><span>Décision</span>
                                    </div>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {data.map((c: any) => {
                                const delib = c.deliberation || {};
                                const evalsT1 = c.evaluations?.filter((e: any) => e.epreuve?.tour === 1) || [];
                                const evalsT2 = c.evaluations?.filter((e: any) => e.epreuve?.tour === 2) || [];
                                const evalsT3 = c.evaluations?.filter((e: any) => e.epreuve?.tour === 3) || [];
                                const isRefused = delib.tour1Status === 'refused' || delib.tour2Status === 'refused' || delib.tour3Status === 'refused';

                                return (
                                    <tr key={c.id} className={clsx("hover:bg-gray-50 group border-b last:border-0 transition-colors", isRefused ? "bg-gray-100 text-gray-400" : "bg-white")}>
                                        <td className={clsx("px-4 py-3 font-medium sticky left-0 group-hover:bg-gray-50 border-r z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] align-top", isRefused ? "bg-gray-100" : "bg-white")}>
                                            <div className={clsx("font-semibold text-base", isRefused ? "text-gray-500" : "text-gray-900")}>{c.firstName} {c.lastName}</div>
                                            <div className="text-xs text-gray-500">{c.email}</div>
                                            <div className="text-xs text-gray-400 mt-1">{c.phone}</div>
                                            {c.comments && (
                                                <div className="mt-2 text-xs bg-yellow-50 border border-yellow-200 rounded p-2 text-yellow-800">
                                                    <span className="font-bold text-[10px] uppercase block mb-0.5">Note interne</span>
                                                    {c.comments}
                                                </div>
                                            )}
                                        </td>
                                        <td className={clsx("px-4 border-r align-top w-96", isRefused ? "bg-gray-100" : "bg-blue-50/10")}>{renderEvals(evalsT1)}</td>
                                        <td className={clsx("px-2 border-r align-top w-32", isRefused ? "bg-gray-100" : "bg-blue-50/10")}>{renderActions(c, 'tour1Status', delib.tour1Status)}</td>
                                        <td className={clsx("px-4 border-r align-top w-96", isRefused ? "bg-gray-100" : "bg-purple-50/10")}>{renderEvals(evalsT2)}</td>
                                        <td className={clsx("px-2 border-r align-top w-32", isRefused ? "bg-gray-100" : "bg-purple-50/10")}>{renderActions(c, 'tour2Status', delib.tour2Status)}</td>
                                        <td className={clsx("px-4 border-r align-top w-96", isRefused ? "bg-gray-100" : "bg-orange-50/10")}>{renderEvals(evalsT3)}</td>
                                        <td className={clsx("px-2 border-r align-top w-32", isRefused ? "bg-gray-100" : "bg-orange-50/10")}>{renderActions(c, 'tour3Status', delib.tour3Status)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
