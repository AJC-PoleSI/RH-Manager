"use client";

// Page Candidats : deux vues sur les mêmes candidats.
//   • Trombinoscope (par défaut) : photos, coups de cœur.
//   • Liste : recherche, filtre par pôle, coordonnées.
// Dans les deux vues, un clic ouvre le même panneau de détail (vœux, créneaux,
// évaluations, commentaire) ; l'admin y retrouve modifier / supprimer, et
// l'export Excel + l'ajout de candidat sont dans l'en-tête commun.
// L'ancienne URL /dashboard/organigramme redirige ici (?vue=trombinoscope).

import { Suspense, useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, Search, Trash2, Edit, ChevronRight, Filter, LayoutGrid, List } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import CandidateDetailPanel from '@/components/candidates/CandidateDetailPanel';
import Trombinoscope from '@/components/candidates/Trombinoscope';
import { exportCandidatesXlsx } from '@/lib/candidates-export';
import { cn } from '@/lib/utils';

type View = 'trombinoscope' | 'liste';

interface Selected {
    id: string;
    initial?: any;
}

/* ------------------------------------------------------------------ */
/*  Vue liste                                                          */
/* ------------------------------------------------------------------ */
function CandidatesList({
    selectedId,
    onOpen,
    onEdit,
    onDelete,
    refreshKey,
}: {
    selectedId: string | null;
    onOpen: (candidate: any) => void;
    onEdit: (candidate: any) => void;
    onDelete: (candidateId: string) => void;
    refreshKey: number;
}) {
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [searchInput, setSearchInput] = useState('');

    // Phase 3 — Filtre par pôle (Choix n°1)
    const [filterPole, setFilterPole] = useState<string>('all');

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
    }, [fetchCandidates, refreshKey]);

    return (
        <Card>
            <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row gap-3 sm:gap-4">
                <div className="relative flex-1 min-w-0">
                    <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
                    <Input
                        placeholder="Rechercher un candidat..."
                        className="pl-10"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                    />
                </div>
                {/* Phase 3 — Filtre Pôle Choix n°1 */}
                <div className="relative w-full sm:w-auto">
                    <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                    <select
                        value={filterPole}
                        onChange={e => { setFilterPole(e.target.value); }}
                        className="pl-9 pr-3 py-2 min-h-[44px] border border-gray-300 rounded-md text-sm bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:min-w-[200px] sm:w-auto"
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
                                className={`p-4 flex items-center justify-between hover:bg-gray-50 group cursor-pointer transition-colors ${selectedId === candidate.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''}`}
                                onClick={() => onOpen(candidate)}
                            >
                                <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                                    <div className="relative shrink-0">
                                        <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center font-bold text-sm">
                                            {candidate.firstName?.[0]}{candidate.lastName?.[0]}
                                        </div>
                                        {candidate.email_verified === false && (
                                            <span
                                                className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 border-2 border-white"
                                                title="Email non vérifié"
                                            />
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-semibold text-gray-900 flex flex-wrap items-center gap-x-2 gap-y-1">
                                            {candidate.firstName} {candidate.lastName}
                                            {candidate.email_verified === false && (
                                                <span className="px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 text-[10px] font-semibold border border-red-200">
                                                    Email non vérifié
                                                </span>
                                            )}
                                        </p>
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500 mt-0.5">
                                            <span className="break-words">{candidate.email}</span>
                                            {candidate.phone && <><span className="hidden sm:inline">·</span><span className="whitespace-nowrap">{candidate.phone}</span></>}
                                            {/* Pole badge */}
                                            {candidate.wishes?.[0]?.pole && (
                                                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold">
                                                    {candidate.wishes[0].pole}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    {/* Un iPhone n'a pas de survol : ces actions restent visibles
                                        sur mobile, et ne se révèlent au survol qu'à partir de md. */}
                                    <div className="flex gap-1 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100" onClick={e => e.stopPropagation()}>
                                        <button className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center hover:bg-gray-200 rounded text-gray-500" onClick={() => onEdit(candidate)} title="Modifier" aria-label="Modifier"><Edit size={16} /></button>
                                        <button className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center hover:bg-red-100 rounded text-red-500" onClick={() => onDelete(candidate.id)} title="Supprimer" aria-label="Supprimer"><Trash2 size={16} /></button>
                                    </div>
                                    <ChevronRight size={16} className="text-gray-300 shrink-0" />
                                </div>
                            </div>
                        ))}
                        {candidates.length === 0 && <div className="p-8 text-center text-gray-500">Aucun candidat trouvé</div>}
                    </div>
                )}
                <div className="p-4 border-t flex justify-between items-center gap-2">
                    <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédent</Button>
                    <span className="text-sm text-gray-500">Page {page} / {totalPages}</span>
                    <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Suivant</Button>
                </div>
            </CardContent>
        </Card>
    );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
function CandidatesHub() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { user } = useAuth();
    const isAdmin = !!user?.isAdmin;
    const { toast } = useToast();

    const view: View = searchParams?.get('vue') === 'liste' ? 'liste' : 'trombinoscope';
    const setView = (v: View) => {
        router.replace(`${pathname}?vue=${v}`, { scroll: false });
    };

    const [selected, setSelected] = useState<Selected | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const refresh = () => setRefreshKey((k) => k + 1);

    const [isCreating, setIsCreating] = useState(false);
    const [newCandidate, setNewCandidate] = useState({ firstName: '', lastName: '', email: '', phone: '', dateOfBirth: '' });
    const [editingCandidate, setEditingCandidate] = useState<any>(null);
    const [exporting, setExporting] = useState(false);

    const openDetail = (candidate: any) => setSelected({ id: candidate.id, initial: candidate });
    const closeDetail = () => setSelected(null);

    // Échap ferme le panneau.
    useEffect(() => {
        if (!selected) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !editingCandidate) setSelected(null);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [selected, editingCandidate]);

    const handleExport = async () => {
        setExporting(true);
        try {
            const count = await exportCandidatesXlsx();
            toast(`Export généré : ${count} candidat(s)`, 'success');
        } catch (e: any) {
            console.error(e);
            toast(e?.response?.data?.error || "Erreur lors de l'export", 'error');
        } finally {
            setExporting(false);
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.post('/candidates', newCandidate);
            setIsCreating(false);
            setNewCandidate({ firstName: '', lastName: '', email: '', phone: '', dateOfBirth: '' });
            refresh();
            toast("Candidat créé", 'success');
        } catch (error: any) {
            console.error(error);
            toast(error.response?.data?.error || "Erreur lors de la création", 'error');
        }
    };

    const handleDelete = useCallback(async (id: string) => {
        if (!confirm('Êtes-vous sûr de vouloir supprimer ce candidat ?')) return;
        try {
            await api.delete(`/candidates/${id}`);
            setSelected((s) => (s?.id === id ? null : s));
            refresh();
            toast('Candidat supprimé', 'success');
        } catch (e) {
            console.error(e);
            toast('Erreur lors de la suppression', 'error');
        }
    }, [toast]);

    const handleSaveEdit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.put(`/candidates/${editingCandidate.id}`, editingCandidate);
            setEditingCandidate(null);
            refresh();
            toast("Candidat modifié", 'success');
        } catch (error) {
            console.error(error);
            toast("Erreur lors de la modification", 'error');
        }
    };

    const panel = selected && (
        <CandidateDetailPanel
            key={selected.id}
            candidateId={selected.id}
            initial={selected.initial}
            isAdmin={isAdmin}
            onClose={closeDetail}
            onEdit={(c) => setEditingCandidate({ ...c })}
            onDelete={handleDelete}
            refreshKey={refreshKey}
        />
    );

    return (
        <div className="space-y-6">
            {/* En-tête commun aux deux vues */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                    <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">Candidats</h1>
                    <div className="mt-2 inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
                        {([
                            ['trombinoscope', 'Trombinoscope', LayoutGrid],
                            ['liste', 'Liste', List],
                        ] as const).map(([v, label, Icon]) => (
                            <button
                                key={v}
                                onClick={() => setView(v)}
                                className={cn(
                                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                                    view === v ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50',
                                )}
                                aria-pressed={view === v}
                            >
                                <Icon size={15} /> {label}
                            </button>
                        ))}
                    </div>
                </div>
                {isAdmin && (
                    <div className="flex gap-2 flex-wrap">
                        <Button variant="secondary" onClick={handleExport} disabled={exporting}>
                            {exporting ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
                            Exporter
                        </Button>
                        <Button onClick={() => setIsCreating(true)}><Plus size={16} className="mr-2" /> Ajouter</Button>
                    </div>
                )}
            </div>

        {/* Create Modal */}
        {isCreating && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] p-4">
                <Card className="w-full max-w-md max-h-modal overflow-y-auto">
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
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] p-4">
                <Card className="w-full max-w-md max-h-modal overflow-y-auto">
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

            {view === 'liste' ? (
                <div className="flex flex-col lg:flex-row gap-6">
                    <div className={`space-y-6 transition-all duration-200 ${selected ? 'w-full lg:w-[45%] lg:min-w-[400px]' : 'w-full'}`}>
                        <CandidatesList
                            selectedId={selected?.id ?? null}
                            onOpen={openDetail}
                            onEdit={(c) => setEditingCandidate({ ...c })}
                            onDelete={handleDelete}
                            refreshKey={refreshKey}
                        />
                    </div>
                    {panel && (
                        <div className="flex-1 w-full lg:min-w-[420px] overflow-y-auto">{panel}</div>
                    )}
                </div>
            ) : (
                <>
                    <Trombinoscope
                        onOpen={openDetail}
                        selectedId={selected?.id ?? null}
                        refreshKey={refreshKey}
                    />
                    {/* Panneau de détail en tiroir : la grille de photos reste
                        visible derrière. */}
                    {panel && (
                        <div className="fixed inset-0 z-[80] flex justify-end">
                            <div className="absolute inset-0 bg-black/30" onClick={closeDetail} />
                            <div className="relative h-full w-full sm:max-w-xl bg-gray-50 shadow-2xl overflow-y-auto p-4">
                                {panel}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export default function CandidatesPage() {
    return (
        <Suspense fallback={<div className="p-8 flex justify-center"><Loader2 className="animate-spin text-gray-400" /></div>}>
            <CandidatesHub />
        </Suspense>
    );
}
