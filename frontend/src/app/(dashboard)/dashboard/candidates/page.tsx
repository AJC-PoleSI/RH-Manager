"use client";

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, Search, Trash2, Edit, X, ChevronRight, Save, ArrowLeft, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface Evaluation {
    id: string;
    candidate_id: string;
    epreuve_id: string;
    member_id: string;
    scores: Record<string, string | number>;
    comment: string;
    created_at: string;
    epreuves: {
        id: string;
        name: string;
        tour: number;
        type: string;
        evaluation_questions: string;
    } | null;
    members: { email: string } | null;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
export default function CandidatesPage() {
    const router = useRouter();
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [newCandidate, setNewCandidate] = useState({ firstName: '', lastName: '', email: '', phone: '', dateOfBirth: '' });
    const [commentCandidate, setCommentCandidate] = useState<any>(null);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [searchInput, setSearchInput] = useState('');
    const [editingCandidate, setEditingCandidate] = useState<any>(null);
    const { toast } = useToast();

    // Phase 3 — Filtre par pôle (Choix n°1)
    const [filterPole, setFilterPole] = useState<string>('all');

    // --- Detail panel state ---
    const [selectedCandidate, setSelectedCandidate] = useState<any>(null);
    const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
    const [loadingEvals, setLoadingEvals] = useState(false);
    const [editingEvalId, setEditingEvalId] = useState<string | null>(null);
    const [editScores, setEditScores] = useState<Record<string, string | number>>({});
    const [editComment, setEditComment] = useState('');
    const [savingEval, setSavingEval] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => {
            setSearch(searchInput);
            setPage(1);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchInput]);


    /* ---- Fetch candidates ---- */
    const fetchCandidates = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/candidates', { params: { page, limit: 10, search } });
            setCandidates(res.data.data);
            setTotalPages(res.data.pagination.totalPages);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [page, search]);

    useEffect(() => {
        fetchCandidates();
    }, [fetchCandidates]);

    /* ---- Fetch evaluations for a candidate ---- */
    const fetchEvaluations = async (candidateId: string) => {
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
                epreuves: ev.epreuves || ev.epreuve || null,
                members: ev.members || (ev.member ? { email: ev.member.email } : null),
            }));
            setEvaluations(evalsData);
        } catch (e) {
            console.error(e);
            toast("Erreur lors du chargement des évaluations", 'error');
        } finally {
            setLoadingEvals(false);
        }
    };

    /* ---- Open detail panel ---- */
    const openDetail = (candidate: any) => {
        setSelectedCandidate(candidate);
        setEditingEvalId(null);
        fetchEvaluations(candidate.id);
    };

    /* ---- Close detail panel ---- */
    const closeDetail = () => {
        setSelectedCandidate(null);
        setEvaluations([]);
        setEditingEvalId(null);
    };

    /* ---- Start editing an evaluation ---- */
    const startEditEval = (ev: Evaluation) => {
        setEditingEvalId(ev.id);
        setEditScores({ ...ev.scores });
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

    /* ---- CRUD candidat ---- */
    const handleExport = () => {
        const csvContent = "data:text/csv;charset=utf-8,"
            + ["Prénom,Nom,Email,Téléphone,Date de naissance", ...candidates.map((c: any) => `${c.firstName},${c.lastName},${c.email},${c.phone},${c.date_of_birth || ''}`)].join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "candidats.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.post('/candidates', newCandidate);
            setIsCreating(false);
            setNewCandidate({ firstName: '', lastName: '', email: '', phone: '', dateOfBirth: '' });
            fetchCandidates();
            toast("Candidat créé", 'success');
        } catch (error: any) {
            console.error(error);
            toast(error.response?.data?.error || "Erreur lors de la création", 'error');
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Êtes-vous sûr de vouloir supprimer ce candidat ?')) return;
        try {
            await api.delete(`/candidates/${id}`);
            setCandidates(candidates.filter((c: any) => c.id !== id));
            if (selectedCandidate?.id === id) closeDetail();
        } catch (e) {
            console.error(e);
            toast('Erreur lors de la suppression', 'error');
        }
    };

    const handleSaveEdit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.put(`/candidates/${editingCandidate.id}`, editingCandidate);
            setEditingCandidate(null);
            fetchCandidates();
            toast("Candidat modifié", 'success');
        } catch (error) {
            console.error(error);
            toast("Erreur lors de la modification", 'error');
        }
    };

    const handleSaveComment = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.put(`/candidates/${commentCandidate.id}`, { comments: commentCandidate.comment });
            setCommentCandidate(null);
            fetchCandidates();
            toast("Commentaire enregistré", 'success');
        } catch (error) {
            console.error(error);
            toast("Erreur lors de l'enregistrement du commentaire", 'error');
        }
    };

    /* ---- Parse questions from epreuve ---- */
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

    /* ================================================================ */
    /*  Render                                                           */
    /* ================================================================ */
    return (
        <div className="flex gap-6 h-full">
            {/* ---- Left: Candidate List ---- */}
            <div className={`space-y-6 transition-all duration-200 ${selectedCandidate ? 'w-[45%] min-w-[400px]' : 'w-full'}`}>
                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-semibold text-gray-900">Candidats</h1>
                        <p className="text-gray-500">Gérez et évaluez vos candidats</p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="secondary" onClick={handleExport}>Exporter</Button>
                        <Button onClick={() => setIsCreating(true)}><Plus size={16} className="mr-2" /> Ajouter</Button>
                    </div>
                </div>

                {/* Create Modal */}
                {isCreating && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                        <Card className="w-96">
                            <CardHeader><CardTitle>Nouveau Candidat</CardTitle></CardHeader>
                            <CardContent>
                                <form onSubmit={handleCreate} className="space-y-4">
                                    <div><Label>Prénom</Label><Input required value={newCandidate.firstName} onChange={e => setNewCandidate({ ...newCandidate, firstName: e.target.value })} /></div>
                                    <div><Label>Nom</Label><Input required value={newCandidate.lastName} onChange={e => setNewCandidate({ ...newCandidate, lastName: e.target.value })} /></div>
                                    <div><Label>Email</Label><Input required type="email" value={newCandidate.email} onChange={e => setNewCandidate({ ...newCandidate, email: e.target.value })} /></div>
                                    <div><Label>Téléphone</Label><Input value={newCandidate.phone} onChange={e => setNewCandidate({ ...newCandidate, phone: e.target.value })} /></div>
                                    <div><Label>Date de naissance</Label><Input type="date" value={newCandidate.dateOfBirth} onChange={e => setNewCandidate({ ...newCandidate, dateOfBirth: e.target.value })} /></div>
                                    <div className="flex justify-end gap-2">
                                        <Button variant="ghost" type="button" onClick={() => setIsCreating(false)}>Annuler</Button>
                                        <Button type="submit">Créer</Button>
                                    </div>
                                </form>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* Edit Modal */}
                {editingCandidate && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                        <Card className="w-96">
                            <CardHeader><CardTitle>Modifier Candidat</CardTitle></CardHeader>
                            <CardContent>
                                <form onSubmit={handleSaveEdit} className="space-y-4">
                                    <div><Label>Prénom</Label><Input value={editingCandidate.firstName} onChange={e => setEditingCandidate({ ...editingCandidate, firstName: e.target.value })} /></div>
                                    <div><Label>Nom</Label><Input value={editingCandidate.lastName} onChange={e => setEditingCandidate({ ...editingCandidate, lastName: e.target.value })} /></div>
                                    <div><Label>Email</Label><Input value={editingCandidate.email} onChange={e => setEditingCandidate({ ...editingCandidate, email: e.target.value })} /></div>
                                    <div><Label>Téléphone</Label><Input value={editingCandidate.phone} onChange={e => setEditingCandidate({ ...editingCandidate, phone: e.target.value })} /></div>
                                    <div><Label>Date de naissance</Label><Input type="date" value={editingCandidate.date_of_birth || ''} onChange={e => setEditingCandidate({ ...editingCandidate, date_of_birth: e.target.value })} /></div>
                                    <div className="flex justify-end gap-2">
                                        <Button variant="ghost" type="button" onClick={() => setEditingCandidate(null)}>Annuler</Button>
                                        <Button type="submit">Enregistrer</Button>
                                    </div>
                                </form>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* Comment Modal */}
                {commentCandidate && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                        <Card className="w-96">
                            <CardHeader><CardTitle>Commentaire pour {commentCandidate.firstName}</CardTitle></CardHeader>
                            <CardContent>
                                <form onSubmit={handleSaveComment} className="space-y-4">
                                    <textarea
                                        className="w-full p-2 border rounded"
                                        rows={4}
                                        placeholder="Saisissez un commentaire..."
                                        value={commentCandidate.comment || ''}
                                        onChange={e => setCommentCandidate({ ...commentCandidate, comment: e.target.value })}
                                    />
                                    <div className="flex justify-end gap-2">
                                        <Button variant="ghost" type="button" onClick={() => setCommentCandidate(null)}>Annuler</Button>
                                        <Button type="submit">Enregistrer</Button>
                                    </div>
                                </form>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* Candidate Table */}
                <Card>
                    <div className="p-4 border-b border-gray-100 flex gap-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
                            <Input
                                placeholder="Rechercher un candidat..."
                                className="pl-10"
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                            />
                        </div>
                        {/* Phase 3 — Filtre Pôle Choix n°1 */}
                        <div className="relative">
                            <Filter className="absolute left-3 top-2.5 text-gray-400" size={16} />
                            <select
                                value={filterPole}
                                onChange={e => { setFilterPole(e.target.value); }}
                                className="pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px]"
                            >
                                <option value="all">Tous les pôles</option>
                                <option value="Système d'information">SI</option>
                                <option value="Marketing">Marketing</option>
                                <option value="Développement commercial">Dev. Commercial</option>
                                <option value="Audit Qualité">Audit Qualité</option>
                                <option value="Ressource Humaine">RH</option>
                                <option value="Trésorerie">Trésorerie</option>
                                <option value="Bureau - VP">Bureau - VP</option>
                                <option value="Bureau - Président">Bureau - Président</option>
                                <option value="Bureau - Trésorier">Bureau - Trésorier</option>
                                <option value="Bureau - Secrétaire générale">Bureau - SG</option>
                                <option value="_none">Sans vœu</option>
                            </select>
                        </div>
                    </div>
                    <CardContent className="p-0">
                        {loading ? (
                            <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-primary-500" /></div>
                        ) : (
                            <div className="divide-y divide-gray-100">
                                {candidates
                                    .filter((candidate: any) => {
                                        if (filterPole === 'all') return true;
                                        const wishes = candidate.wishes || [];
                                        const wish1 = wishes.find((w: any) => w.rank === 1);
                                        if (filterPole === '_none') return !wish1;
                                        return wish1?.pole === filterPole;
                                    })
                                    .map((candidate: any) => (
                                    <div
                                        key={candidate.id}
                                        className={`p-4 flex items-center justify-between hover:bg-gray-50 group cursor-pointer transition-colors ${selectedCandidate?.id === candidate.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''}`}
                                        onClick={() => openDetail(candidate)}
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center font-bold text-sm">
                                                {candidate.firstName?.[0]}{candidate.lastName?.[0]}
                                            </div>
                                            <div>
                                                <p className="font-semibold text-gray-900">{candidate.firstName} {candidate.lastName}</p>
                                                <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                                                    <span>{candidate.email}</span>
                                                    {candidate.phone && <><span>·</span><span>{candidate.phone}</span></>}
                                                    {/* Pole badge */}
                                                    {candidate.wishes?.[0]?.pole && (
                                                        <span className="ml-1 px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold">
                                                            {candidate.wishes[0].pole}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                                <button className="p-1.5 hover:bg-gray-200 rounded text-gray-500" onClick={() => setEditingCandidate({ ...candidate })} title="Modifier"><Edit size={14} /></button>
                                                <button className="p-1.5 hover:bg-red-100 rounded text-red-500" onClick={() => handleDelete(candidate.id)} title="Supprimer"><Trash2 size={14} /></button>
                                            </div>
                                            <ChevronRight size={16} className="text-gray-300" />
                                        </div>
                                    </div>
                                ))}
                                {candidates.length === 0 && <div className="p-8 text-center text-gray-500">Aucun candidat trouvé</div>}
                            </div>
                        )}
                        <div className="p-4 border-t flex justify-between items-center">
                            <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédent</Button>
                            <span className="text-sm text-gray-500">Page {page} / {totalPages}</span>
                            <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Suivant</Button>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* ---- Right: Detail Panel ---- */}
            {selectedCandidate && (
                <div className="flex-1 min-w-[420px] space-y-4 overflow-y-auto">
                    {/* Candidate header */}
                    <Card>
                        <CardContent className="p-5">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="w-14 h-14 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center text-xl font-bold">
                                        {selectedCandidate.firstName?.[0]}{selectedCandidate.lastName?.[0]}
                                    </div>
                                    <div>
                                        <h1 className="text-xl font-semibold text-gray-900">{selectedCandidate.firstName} {selectedCandidate.lastName}</h1>
                                        <p className="text-sm text-gray-500">{selectedCandidate.email}</p>
                                        <div className="flex gap-4 mt-1 text-xs text-gray-400">
                                            {selectedCandidate.phone && <span>{selectedCandidate.phone}</span>}
                                            {selectedCandidate.date_of_birth && <span>Né(e) le {selectedCandidate.date_of_birth}</span>}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <Button size="sm" variant="primary" onClick={() => router.push(`/dashboard/candidates/${selectedCandidate.id}/evaluate`)}>
                                        <Plus size={14} className="mr-1" /> Évaluer
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => setCommentCandidate({ ...selectedCandidate, comment: selectedCandidate.comments || '' })}>
                                        Commenter
                                    </Button>
                                    <button onClick={closeDetail} className="p-2 hover:bg-gray-100 rounded text-gray-400">
                                        <X size={18} />
                                    </button>
                                </div>
                            </div>
                            {selectedCandidate.comments && (
                                <div className="mt-4 p-3 bg-yellow-50 rounded-lg text-sm text-gray-700 border border-yellow-100">
                                    <span className="font-medium text-yellow-700">Note : </span>{selectedCandidate.comments}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Evaluations */}
                    <Card>
                        <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-lg">Évaluations ({evaluations.length})</CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            {loadingEvals ? (
                                <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-primary-500" /></div>
                            ) : evaluations.length === 0 ? (
                                <div className="p-8 text-center text-gray-400">
                                    <p className="mb-2">Aucune évaluation pour ce candidat</p>
                                    <Button size="sm" variant="outline" onClick={() => router.push(`/dashboard/candidates/${selectedCandidate.id}/evaluate`)}>
                                        Créer une évaluation
                                    </Button>
                                </div>
                            ) : (
                                <div className="divide-y divide-gray-100">
                                    {evaluations.map((ev) => {
                                        const questions = parseQuestions(ev.epreuves);
                                        const isEditing = editingEvalId === ev.id;

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
                                                            const scoreVal = isEditing ? (editScores[scoreKey] ?? '') : (ev.scores[scoreKey] ?? '-');
                                                            return (
                                                                <div key={idx} className="flex items-center justify-between text-sm">
                                                                    <span className="text-gray-600">
                                                                        {q.q || `Critère ${idx + 1}`}
                                                                        <span className="text-xs text-gray-400 ml-1">(coeff. {q.weight || 1})</span>
                                                                    </span>
                                                                    {isEditing ? (
                                                                        <Input
                                                                            type="number"
                                                                            min="0"
                                                                            className="w-20 h-8 text-sm text-right"
                                                                            value={editScores[scoreKey] ?? ''}
                                                                            onChange={e => setEditScores({ ...editScores, [scoreKey]: e.target.value })}
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
                                                                            type="number"
                                                                            min="0"
                                                                            className="w-20 h-8 text-sm text-right"
                                                                            value={editScores[key] ?? ''}
                                                                            onChange={e => setEditScores({ ...editScores, [key]: e.target.value })}
                                                                        />
                                                                    ) : (
                                                                        <span className="font-semibold text-gray-900 bg-gray-100 px-2 py-0.5 rounded text-xs">{String(val)}</span>
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
            )}
        </div>
    );
}
