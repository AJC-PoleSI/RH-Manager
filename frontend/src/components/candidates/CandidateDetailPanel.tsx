"use client";

// Panneau de détail d'un candidat : identité, vœux (avec l'option bureau),
// commentaire interne, créneaux et évaluations critère par critère.
// Partagé par les deux vues de la page Candidats (trombinoscope et liste).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import CandidatePhoto from '@/components/ui/CandidatePhoto';
import CandidateSlots from '@/components/candidates/CandidateSlots';
import { Edit, ExternalLink, Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import {
    averageOn20ByEpreuve,
    formatScore,
    getCriterionLabel,
    getMaxPoints,
    getTotalMaxPoints,
    hasAnyScore,
    isScoreInput,
    sumScores,
    toTwenty,
} from '@/lib/evaluation-criteria';
import { isBureauEligiblePole, wishDetailLabel } from '@/lib/wishes';

export interface Evaluation {
    id: string;
    candidate_id: string;
    epreuve_id: string;
    member_id: string;
    scores: Record<string, string | number>;
    comment: string;
    created_at: string;
    /** Note de deuxième grille (propale…) : lecture seule dans ce panneau. */
    isSecondGrid?: boolean;
    /** Deuxième grille : épreuve d'origine, à ouvrir pour la compléter. */
    secondGridEpreuveId?: string | null;
    /** Ancienne note collective de business game : affichée, hors moyenne. */
    isLegacyCollective?: boolean;
    epreuves: {
        id: string;
        name: string;
        tour: number;
        type: string;
        evaluation_questions: string;
    } | null;
    members: { email: string } | null;
}

/**
 * Note globale d'une évaluation : total obtenu, barème de l'épreuve et note
 * ramenée sur 20. Calculée depuis la grille affichée, pour suivre une
 * modification sans attendre le serveur. null si aucune note ou barème inconnu.
 */
function evaluationTotal(ev: Evaluation): { obtained: number; maxTotal: number; on20: number } | null {
    const maxTotal = getTotalMaxPoints(ev.epreuves?.evaluation_questions);
    if (!hasAnyScore(ev.scores) || maxTotal <= 0) return null;
    const obtained = sumScores(ev.scores);
    return { obtained, maxTotal, on20: toTwenty(obtained, maxTotal) };
}

/** « 13,6 » — une note /20 à la française. */
const fmt20 = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

/** Critères d'une épreuve (chaîne JSON ou tableau). */
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

export default function CandidateDetailPanel({
    candidateId,
    initial,
    isAdmin,
    onClose,
    onEdit,
    onDelete,
    refreshKey = 0,
}: {
    candidateId: string;
    /** Ce que la vue appelante sait déjà (affiché en attendant la fiche). */
    initial?: any;
    isAdmin: boolean;
    onClose: () => void;
    /** Admin : ouvrir la modale de modification du candidat. */
    onEdit?: (candidate: any) => void;
    /** Admin : supprimer le candidat. */
    onDelete?: (candidateId: string) => void;
    /** Incrémenté par la page après une modification : recharge la fiche. */
    refreshKey?: number;
}) {
    const router = useRouter();
    const { toast } = useToast();
    const [candidate, setCandidate] = useState<any>(initial || { id: candidateId });
    const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
    const [loadingEvals, setLoadingEvals] = useState(false);
    const [editingEvalId, setEditingEvalId] = useState<string | null>(null);
    const [editScores, setEditScores] = useState<Record<string, string | number>>({});
    const [editComment, setEditComment] = useState('');
    const [savingEval, setSavingEval] = useState(false);
    const [commentDraft, setCommentDraft] = useState<string | null>(null);

    // Fiche complète (vœux avec option bureau, commentaire interne…) : la
    // vignette du trombinoscope ne porte que le nom et la photo.
    const loadCandidate = useCallback(async () => {
        try {
            const res = await api.get(`/candidates/${candidateId}`);
            setCandidate((prev: any) => ({ ...prev, ...res.data }));
        } catch (e) {
            console.error(e);
        }
    }, [candidateId]);

    /* ---- Fetch evaluations for a candidate ---- */
    const fetchEvaluations = useCallback(async (candidateId: string) => {
        setLoadingEvals(true);
        try {
            const res = await api.get(`/evaluations/candidate/${candidateId}`);
            // L'API retourne { evaluations, byEpreuve } — extraire le tableau
            const rawEvals = res.data?.evaluations || (Array.isArray(res.data) ? res.data : []);
            // Mapper le format camelCase de l'API vers le format snake_case attendu par le panneau
            const evalsData = rawEvals.map((ev: any) => ({
                id: ev.id,
                candidate_id: ev.candidateId || ev.candidate_id,
                epreuve_id: ev.epreuveId || ev.epreuve_id || ev.epreuve?.id,
                member_id: ev.memberId || ev.member_id || ev.member?.id,
                scores: ev.scores || {},
                comment: ev.comment || '',
                created_at: ev.createdAt || ev.created_at,
                // BUG FIX : ev.epreuve (API) porte evaluationQuestions en
                // camelCase — sans ce mapping, parseQuestions() ne trouvait
                // jamais evaluation_questions et retombait sur "Critère N".
                epreuves: ev.epreuves
                    ? ev.epreuves
                    : ev.epreuve
                        ? { ...ev.epreuve, evaluation_questions: ev.epreuve.evaluationQuestions ?? ev.epreuve.evaluation_questions }
                        : null,
                members: ev.members || (ev.member ? { email: ev.member.email } : null),
                // Deuxième grille (propale…) : se modifie depuis l'écran de
                // notation, pas ici (ce n'est pas une ligne candidate_evaluations).
                isSecondGrid: !!ev.isSecondGrid,
                secondGridEpreuveId: ev.isSecondGrid
                    ? ev.epreuve?.parentId || String(ev.epreuve?.id || '').replace(/:second$/, '') || null
                    : null,
                isLegacyCollective: !!ev.isLegacyCollective,
            }));
            setEvaluations(evalsData);
        } catch (e) {
            console.error(e);
            toast("Erreur lors du chargement des évaluations", 'error');
        } finally {
            setLoadingEvals(false);
        }
    }, [toast]);

    // Notes globales : moyenne de chaque épreuve (examinateurs moyennés entre
    // eux) et moyenne de chaque tour, pondérée par barème — mêmes règles que
    // la délibération (averageOn20ByEpreuve). Hors anciennes notes collectives.
    const gradeSummary = useMemo(() => {
        const counted = evaluations
            .map(ev => ({ ev, total: evaluationTotal(ev) }))
            .filter((x): x is { ev: Evaluation; total: NonNullable<ReturnType<typeof evaluationTotal>> } =>
                x.total !== null && !x.ev.isLegacyCollective);
        const toItem = (x: (typeof counted)[number]) => ({
            epreuveKey: x.ev.epreuves?.id || x.ev.epreuve_id || x.ev.epreuves?.name || 'unknown',
            obtained: x.total.obtained,
            maxTotal: x.total.maxTotal,
        });
        const epreuves = new Map<string, { name: string; tour: number | null; items: typeof counted }>();
        for (const x of counted) {
            const key = toItem(x).epreuveKey;
            const entry = epreuves.get(key) || { name: x.ev.epreuves?.name || 'Épreuve', tour: x.ev.epreuves?.tour ?? null, items: [] };
            entry.items.push(x);
            epreuves.set(key, entry);
        }
        const tours = Array.from(new Set(counted.map(x => x.ev.epreuves?.tour ?? 0))).sort((a, b) => a - b);
        return {
            byTour: tours.map(tour => {
                const items = counted.filter(x => (x.ev.epreuves?.tour ?? 0) === tour);
                return { tour, average: averageOn20ByEpreuve(items.map(toItem)), count: items.length };
            }),
            byEpreuve: Array.from(epreuves.values())
                .map(e => ({ ...e, average: averageOn20ByEpreuve(e.items.map(toItem)) }))
                .sort((a, b) => (a.tour ?? 0) - (b.tour ?? 0) || a.name.localeCompare(b.name, 'fr')),
            overall: tours.length > 1 ? averageOn20ByEpreuve(counted.map(toItem)) : null,
        };
    }, [evaluations]);

    /* ---- Start editing an evaluation ---- */
    const startEditEval = (ev: Evaluation) => {
        setEditingEvalId(ev.id);
        // Notes réaffichées à la française (3.5 → « 3,5 ») : c'est ce que
        // l'examinateur a saisi, et la virgule est acceptée au réenregistrement.
        setEditScores(
            Object.fromEntries(
                Object.entries(ev.scores || {}).map(([k, v]) => [k, formatScore(v)]),
            ),
        );
        setEditComment(ev.comment || '');
    };

    /* ---- Save edited evaluation ---- */
    const saveEditEval = async () => {
        if (!editingEvalId) return;
        setSavingEval(true);
        try {
            const res = await api.put(`/evaluations/${editingEvalId}`, {
                scores: editScores,
                comment: editComment,
            });
            setEvaluations(prev =>
                prev.map(ev => ev.id === editingEvalId ? { ...ev, scores: res.data.scores, comment: res.data.comment } : ev)
            );
            setEditingEvalId(null);
            toast("Évaluation modifiée", 'success');
        } catch (e) {
            console.error(e);
            toast("Erreur lors de la modification", 'error');
        } finally {
            setSavingEval(false);
        }
    };

    /* ---- Delete evaluation ---- */
    const deleteEval = async (evalId: string) => {
        if (!confirm("Supprimer cette évaluation ?")) return;
        try {
            await api.delete(`/evaluations/${evalId}`);
            setEvaluations(prev => prev.filter(ev => ev.id !== evalId));
            toast("Évaluation supprimée", 'success');
        } catch (e) {
            console.error(e);
            toast("Erreur lors de la suppression", 'error');
        }
    };

    useEffect(() => {
        setCandidate((prev: any) =>
            prev?.id === candidateId ? prev : initial || { id: candidateId },
        );
        setEditingEvalId(null);
        loadCandidate();
        fetchEvaluations(candidateId);
        // `initial` change à chaque rendu de la page : seule l'identité compte.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [candidateId, refreshKey, loadCandidate, fetchEvaluations]);

    const handleSaveComment = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.put(`/candidates/${candidateId}`, { comments: commentDraft });
            setCandidate((prev: any) => ({ ...prev, comments: commentDraft }));
            setCommentDraft(null);
            toast("Commentaire enregistré", 'success');
        } catch (error) {
            console.error(error);
            toast("Erreur lors de l'enregistrement du commentaire", 'error');
        }
    };

    const wishes: any[] = candidate.wishes || [];

    return (
        <div className="space-y-4">
            {/* Comment Modal */}
            {commentDraft !== null && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
                    <Card className="w-full max-w-md max-h-modal overflow-y-auto">
                        <CardHeader><CardTitle>Commentaire pour {candidate.firstName}</CardTitle></CardHeader>
                        <CardContent>
                            <form onSubmit={handleSaveComment} className="space-y-4">
                                <textarea
                                    className="w-full p-2 border rounded"
                                    rows={4}
                                    placeholder="Saisissez un commentaire..."
                                    value={commentDraft}
                                    onChange={e => setCommentDraft(e.target.value)}
                                />
                                <div className="flex justify-end gap-2">
                                    <Button variant="ghost" type="button" onClick={() => setCommentDraft(null)}>Annuler</Button>
                                    <Button type="submit">Enregistrer</Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Candidate header */}
            <Card>
                <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-4 min-w-0">
                            <CandidatePhoto
                                candidateId={candidateId}
                                firstName={candidate.firstName}
                                lastName={candidate.lastName}
                                hasPhoto={!!candidate.hasPhoto}
                                version={candidate.photoUpdatedAt}
                                size={56}
                            />
                            <div className="min-w-0">
                                <h1 className="text-xl font-semibold text-gray-900">{candidate.firstName} {candidate.lastName}</h1>
                                {candidate.email && <p className="text-sm text-gray-500 break-words">{candidate.email}</p>}
                                <div className="flex flex-wrap gap-x-4 mt-1 text-xs text-gray-400">
                                    {candidate.phone && <span>{candidate.phone}</span>}
                                    {candidate.date_of_birth && <span>Né(e) le {candidate.date_of_birth}</span>}
                                </div>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded text-gray-400 shrink-0" aria-label="Fermer">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="flex flex-wrap gap-2 mt-4">
                        {/* Admin uniquement : peut évaluer depuis l'espace candidats.
                            Les members non-admin doivent passer par leur slot. */}
                        {isAdmin && (
                            <Button size="sm" variant="primary" onClick={() => router.push(`/dashboard/candidates/${candidateId}/evaluate`)}>
                                <Plus size={14} className="mr-1" /> Évaluer
                            </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => setCommentDraft(candidate.comments || '')}>
                            Commenter
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => router.push(`/dashboard/candidates/${candidateId}`)}>
                            <ExternalLink size={14} className="mr-1" /> Fiche complète
                        </Button>
                        {isAdmin && onEdit && (
                            <Button size="sm" variant="ghost" onClick={() => onEdit(candidate)}>
                                <Edit size={14} className="mr-1" /> Modifier
                            </Button>
                        )}
                        {isAdmin && onDelete && (
                            <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => onDelete(candidateId)}>
                                <Trash2 size={14} className="mr-1" /> Supprimer
                            </Button>
                        )}
                    </div>

                    {/* Vœux, avec l'option bureau / le poste visé */}
                    {wishes.length > 0 && (
                        <div className="mt-4">
                            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Choix de pôle</p>
                            <div className="flex flex-wrap gap-1.5">
                                {wishes.map((w: any) => (
                                    <span key={`${w.rank}-${w.pole}`} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border bg-gray-50 text-gray-700 border-gray-200">
                                        <span className="font-bold">{w.rank}.</span> {w.pole}
                                        {wishDetailLabel(w) ? (
                                            <span className="ml-0.5 font-semibold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">{wishDetailLabel(w)}</span>
                                        ) : isBureauEligiblePole(w.pole) ? (
                                            <span className="ml-0.5 font-normal text-gray-400">· sans bureau</span>
                                        ) : null}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {candidate.comments && (
                        <div className="mt-4 p-3 bg-yellow-50 rounded-lg text-sm text-gray-700 border border-yellow-100">
                            <span className="font-medium text-yellow-700">Note : </span>{candidate.comments}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Créneaux : quand, où et avec quels examinateurs
                passe ce candidat. */}
            <CandidateSlots candidateId={candidateId} />

        {/* Evaluations */}
        <Card>
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Évaluations ({evaluations.length})</CardTitle>
                </div>
                {!loadingEvals && gradeSummary.byTour.length > 0 && (
                    <div className="mt-3 space-y-3">
                        <div className="flex flex-wrap gap-2">
                            {gradeSummary.byTour.map(t => (
                                <div key={t.tour} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                                    <p className="text-[11px] font-medium text-blue-600">
                                        Moyenne {t.tour ? `Tour ${t.tour}` : ''}
                                    </p>
                                    <p className="text-xl font-bold text-blue-800 leading-tight">
                                        {t.average !== null ? fmt20(t.average) : '-'}
                                        <span className="text-xs font-normal text-blue-500"> /20</span>
                                    </p>
                                    <p className="text-[10px] text-blue-500">{t.count} note{t.count > 1 ? 's' : ''}</p>
                                </div>
                            ))}
                            {gradeSummary.overall !== null && (
                                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                                    <p className="text-[11px] font-medium text-gray-500">Tous tours</p>
                                    <p className="text-xl font-bold text-gray-800 leading-tight">
                                        {fmt20(gradeSummary.overall)}
                                        <span className="text-xs font-normal text-gray-400"> /20</span>
                                    </p>
                                </div>
                            )}
                        </div>
                        <div className="rounded-lg border border-gray-100 divide-y divide-gray-100">
                            {gradeSummary.byEpreuve.map(e => (
                                <div key={`${e.tour}-${e.name}`} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                                    <span className="text-gray-700 min-w-0">
                                        {e.name}
                                        <span className="ml-1.5 text-[11px] text-gray-400">T{e.tour ?? '?'}</span>
                                    </span>
                                    <span className="shrink-0 whitespace-nowrap">
                                        <span className="font-semibold text-gray-900">
                                            {e.average !== null ? `${fmt20(e.average)}/20` : '-'}
                                        </span>
                                        {e.items.length > 1 && (
                                            <span className="ml-1 text-[11px] text-gray-400">· moyenne de {e.items.length} notes</span>
                                        )}
                                    </span>
                                </div>
                            ))}
                        </div>
                        <p className="text-[10px] text-gray-400">
                            Notes ramenées sur 20 ; plusieurs examinateurs sur une épreuve sont moyennés, et chaque épreuve
                            pèse dans la moyenne du tour selon son barème.
                        </p>
                    </div>
                )}
            </CardHeader>
            <CardContent className="p-0">
                {loadingEvals ? (
                    <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-primary-500" /></div>
                ) : evaluations.length === 0 ? (
                    <div className="p-8 text-center text-gray-400">
                        <p className="mb-2">Aucune évaluation pour ce candidat</p>
                        {isAdmin ? (
                            <Button size="sm" variant="outline" onClick={() => router.push(`/dashboard/candidates/${candidate.id}/evaluate`)}>
                                Créer une évaluation
                            </Button>
                        ) : (
                            <p className="text-xs italic">
                                Les évaluations sont créées par les examinateurs
                                assignés depuis la fiche du créneau.
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="divide-y divide-gray-100">
                        {evaluations.map((ev) => {
                            const questions = parseQuestions(ev.epreuves);
                            const isEditing = editingEvalId === ev.id;
                            const total = evaluationTotal(ev);

                            return (
                                <div key={ev.id} className={`p-4 ${isEditing ? 'bg-blue-50/50' : ''}`}>
                                    {/* Header row */}
                                    <div className="flex items-center justify-between mb-3">
                                        <div>
                                            <span className="font-semibold text-gray-900">
                                                {ev.epreuves?.name || 'Épreuve inconnue'}
                                            </span>
                                            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                                                Tour {ev.epreuves?.tour}
                                            </span>
                                            {total && !isEditing && (
                                                <span
                                                    className={`ml-2 inline-flex items-baseline gap-1 text-xs px-2 py-0.5 rounded-full font-semibold ${
                                                        ev.isLegacyCollective ? 'bg-gray-100 text-gray-400' : 'bg-blue-50 text-blue-700'
                                                    }`}
                                                    title={ev.isLegacyCollective ? 'Ancienne note collective de business game : hors moyenne' : undefined}
                                                >
                                                    {fmt20(total.on20)}/20
                                                    <span className="font-normal text-[10px] opacity-70">
                                                        ({formatScore(total.obtained)} / {formatScore(total.maxTotal)})
                                                    </span>
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {isEditing ? (
                                                <>
                                                    <Button size="sm" variant="ghost" onClick={() => setEditingEvalId(null)} disabled={savingEval}>Annuler</Button>
                                                    <Button size="sm" onClick={saveEditEval} disabled={savingEval}>
                                                        {savingEval ? <Loader2 size={14} className="animate-spin mr-1" /> : <Save size={14} className="mr-1" />}
                                                        Enregistrer
                                                    </Button>
                                                </>
                                            ) : ev.isSecondGrid ? (
                                                isAdmin && ev.secondGridEpreuveId ? (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => router.push(`/dashboard/candidates/${candidateId}/evaluate?epreuveId=${ev.secondGridEpreuveId}&grille=2`)}
                                                    >
                                                        <Edit size={14} className="mr-1" /> Compléter
                                                    </Button>
                                                ) : null
                                            ) : (
                                                <>
                                                    <button className="p-1.5 hover:bg-blue-100 rounded text-blue-600" onClick={() => startEditEval(ev)} title="Modifier"><Edit size={14} /></button>
                                                    <button className="p-1.5 hover:bg-red-100 rounded text-red-500" onClick={() => deleteEval(ev.id)} title="Supprimer"><Trash2 size={14} /></button>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {/* Evaluator info */}
                                    <div className="text-xs text-gray-500 mb-3">
                                        Évalué par <span className="font-medium text-gray-700">{ev.members?.email || 'Inconnu'}</span>
                                        <span className="mx-2">·</span>
                                        {new Date(ev.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                                    </div>

                                    {/* Scores */}
                                    <div className="space-y-2">
                                        {questions.length > 0 ? (
                                            questions.map((q, idx) => {
                                                const scoreKey = String(idx);
                                                const scoreVal = isEditing
                                                    ? (editScores[scoreKey] ?? '')
                                                    : (formatScore(ev.scores[scoreKey]) || '-');
                                                return (
                                                    <div key={idx} className="flex items-center justify-between text-sm">
                                                        <span className="text-gray-600">
                                                            {getCriterionLabel(q) || `Critère ${idx + 1}`}
                                                            <span className="text-xs text-gray-400 ml-1">(/ {getMaxPoints(q)})</span>
                                                        </span>
                                                        {isEditing ? (
                                                            <Input
                                                                type="text"
                                                                inputMode="decimal"
                                                                className="w-20 h-8 text-sm text-right"
                                                                value={editScores[scoreKey] ?? ''}
                                                                onChange={e => {
                                                                    const val = e.target.value.replace(/\s/g, '');
                                                                    if (!isScoreInput(val)) return;
                                                                    setEditScores({ ...editScores, [scoreKey]: val });
                                                                }}
                                                            />
                                                        ) : (
                                                            <span className="font-semibold text-gray-900 bg-gray-100 px-2 py-0.5 rounded text-xs">
                                                                {scoreVal}
                                                            </span>
                                                        )}
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            /* Fallback: show raw scores if no questions defined */
                                            Object.entries(ev.scores).length > 0 ? (
                                                Object.entries(isEditing ? editScores : ev.scores).map(([key, val]) => (
                                                    <div key={key} className="flex items-center justify-between text-sm">
                                                        <span className="text-gray-600">Critère {parseInt(key) + 1}</span>
                                                        {isEditing ? (
                                                            <Input
                                                                type="text"
                                                                inputMode="decimal"
                                                                className="w-20 h-8 text-sm text-right"
                                                                value={editScores[key] ?? ''}
                                                                onChange={e => {
                                                                    const val = e.target.value.replace(/\s/g, '');
                                                                    if (!isScoreInput(val)) return;
                                                                    setEditScores({ ...editScores, [key]: val });
                                                                }}
                                                            />
                                                        ) : (
                                                            <span className="font-semibold text-gray-900 bg-gray-100 px-2 py-0.5 rounded text-xs">{formatScore(val) || String(val)}</span>
                                                        )}
                                                    </div>
                                                ))
                                            ) : (
                                                <p className="text-xs text-gray-400 italic">Aucun score enregistré</p>
                                            )
                                        )}
                                    </div>

                                    {/* Comment */}
                                    <div className="mt-3">
                                        {isEditing ? (
                                            <div>
                                                <Label className="text-xs text-gray-500">Commentaire</Label>
                                                <textarea
                                                    className="w-full p-2 border rounded-md text-sm mt-1"
                                                    rows={2}
                                                    value={editComment}
                                                    onChange={e => setEditComment(e.target.value)}
                                                    placeholder="Commentaire de l'évaluation..."
                                                />
                                            </div>
                                        ) : ev.comment ? (
                                            <p className="text-sm text-gray-600 bg-gray-50 rounded p-2 mt-1">
                                                <span className="text-xs font-medium text-gray-400">Commentaire : </span>
                                                {ev.comment}
                                            </p>
                                        ) : null}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
        </div>
    );
}
