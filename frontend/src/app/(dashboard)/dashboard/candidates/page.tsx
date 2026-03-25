"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, Search, Trash2, Edit } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';

export default function CandidatesPage() {
    const router = useRouter();
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [newCandidate, setNewCandidate] = useState({ firstName: '', lastName: '', email: '', phone: '' });
    const [commentCandidate, setCommentCandidate] = useState<any>(null);
    // State for pagination
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [searchInput, setSearchInput] = useState(''); // Debounce buffer
    const [editingCandidate, setEditingCandidate] = useState<any>(null);
    const { toast } = useToast();


    useEffect(() => {
        const timer = setTimeout(() => {
            setSearch(searchInput);
            setPage(1); // Reset page on search
        }, 300);
        return () => clearTimeout(timer);
    }, [searchInput]);

    useEffect(() => {
        fetchCandidates();
    }, [page, search]);

    const handleExport = () => {
        const csvContent = "data:text/csv;charset=utf-8,"
            + ["Prénom,Nom,Email,Téléphone", ...candidates.map((c: any) => `${c.firstName},${c.lastName},${c.email},${c.phone}`)].join("\n");
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
            setNewCandidate({ firstName: '', lastName: '', email: '', phone: '' });
            fetchCandidates();
        } catch (error: any) {
            console.error(error);
            const msg = error.response?.data?.error || "Erreur lors de la création";
            toast(msg, 'error');
        }
    };

    const fetchCandidates = async () => {
        setLoading(true); // Ensure loading state is shown
        try {
            const res = await api.get('/candidates', { params: { page, limit: 10, search } });
            setCandidates(res.data.data);
            setTotalPages(res.data.pagination.totalPages);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Êtes-vous sûr de vouloir supprimer ce candidat ?')) return;
        try {
            await api.delete(`/candidates/${id}`);
            setCandidates(candidates.filter((c: any) => c.id !== id));
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
        } catch (error) {
            console.error(error);
            toast("Erreur lors de la modification", 'error');
        }
    };

    const handleSaveComment = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.put(`/candidates/${commentCandidate.id}`, {
                comments: commentCandidate.comment
            });
            setCommentCandidate(null);
            fetchCandidates();
        } catch (error) {
            console.error(error);
            toast("Erreur lors de l'enregistrement du commentaire", 'error');
        }
    };


    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Candidats</h1>
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
                                <div className="flex justify-end gap-2">
                                    <Button variant="ghost" type="button" onClick={() => setIsCreating(false)}>Annuler</Button>
                                    <Button type="submit">Créer</Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>
                </div>
            )}

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
                                <div className="flex justify-end gap-2">
                                    <Button variant="ghost" type="button" onClick={() => setEditingCandidate(null)}>Annuler</Button>
                                    <Button type="submit">Enregistrer</Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>
                </div>
            )}

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
                </div>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-primary-500" /></div>
                    ) : (
                        <div className="divide-y divide-gray-100">
                            {candidates.map((candidate: any) => (
                                <div key={candidate.id} className="p-4 flex items-center justify-between hover:bg-gray-50 group">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center font-bold">
                                            {candidate.firstName?.[0]}{candidate.lastName?.[0]}
                                        </div>
                                        <div>
                                            <p className="font-semibold text-gray-900">{candidate.firstName} {candidate.lastName}</p>
                                            <div className="flex items-center gap-4 text-xs text-gray-500 mt-0.5">
                                                <span>{candidate.email}</span>
                                                <span>•</span>
                                                <span>{candidate.phone}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Button size="sm" variant="primary" onClick={() => router.push(`/dashboard/candidates/${candidate.id}/evaluate`)}>Évaluer</Button>
                                        <Button size="sm" variant="outline" onClick={() => setCommentCandidate({ ...candidate, comment: candidate.comments || '' })}>Commenter</Button>
                                        <button className="p-2 hover:bg-gray-200 rounded text-gray-500" onClick={() => setEditingCandidate({ ...candidate })}><Edit size={16} /></button>
                                        <button className="p-2 hover:bg-red-100 rounded text-red-500" onClick={() => handleDelete(candidate.id)}><Trash2 size={16} /></button>
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
    );
}
