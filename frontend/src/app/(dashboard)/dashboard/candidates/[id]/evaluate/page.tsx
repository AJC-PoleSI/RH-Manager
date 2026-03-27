"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';

export default function EvaluateCandidatePage({ params }: { params: { id: string } }) {
    const router = useRouter();
    const [candidate, setCandidate] = useState<any>(null);
    const [epreuves, setEpreuves] = useState<any[]>([]);
    const [selectedEpreuveId, setSelectedEpreuveId] = useState<string>('');
    const [formData, setFormData] = useState<{ scores: any, comment: string }>({ scores: {}, comment: '' });
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    useEffect(() => {
        const loadData = async () => {
            try {
                const [candRes, epRes] = await Promise.all([
                    api.get(`/candidates/${params.id}`),
                    api.get('/epreuves')
                ]);
                setCandidate(candRes.data);
                setEpreuves(epRes.data);
            } catch (error) {
                console.error(error);
                toast("Erreur lors du chargement des données", 'error');
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [params.id]);

    const selectedEpreuve = epreuves.find(e => e.id === selectedEpreuveId);
    let questions = [];
    try {
        if (selectedEpreuve?.evaluationQuestions) {
            questions = typeof selectedEpreuve.evaluationQuestions === 'string'
                ? JSON.parse(selectedEpreuve.evaluationQuestions)
                : selectedEpreuve.evaluationQuestions;
        }
    } catch (e) {
        console.error("Error parsing questions", e);
        questions = [];
    }

    const handleScoreChange = (index: number, val: string) => {
        setFormData(prev => ({
            ...prev,
            scores: { ...prev.scores, [index]: val }
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.post('/evaluations', {
                candidateId: params.id,
                epreuveId: selectedEpreuveId,
                scores: formData.scores,
                comment: formData.comment
            });
            toast("Évaluation enregistrée !", 'success');
            router.push('/dashboard/candidates');
        } catch (error: any) {
            console.error(error);
            // Afficher le message d'erreur exact du backend (anti-double évaluation)
            const serverMsg = error?.response?.data?.error;
            toast(serverMsg || "Erreur lors de l'enregistrement", 'error');
        }
    };

    if (loading) return <div className="p-8">Chargement...</div>;
    if (!candidate) return <div className="p-8">Candidat introuvable</div>;

    return (
        <div className="space-y-6 max-w-2xl mx-auto">
            <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center text-2xl font-bold text-primary-700">
                    {candidate.firstName?.[0]}{candidate.lastName?.[0]}
                </div>
                <div>
                    <h1 className="text-2xl font-bold">{candidate.firstName} {candidate.lastName}</h1>
                    <p className="text-gray-500">{candidate.email}</p>
                </div>
            </div>

            <Card>
                <CardHeader><CardTitle>Nouvelle Évaluation</CardTitle></CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <Label>Choisir l&apos;épreuve</Label>
                            <select
                                className="w-full p-2 border rounded-md"
                                value={selectedEpreuveId}
                                onChange={e => setSelectedEpreuveId(e.target.value)}
                                required
                            >
                                <option value="">-- Sélectionner une épreuve --</option>
                                {epreuves.map(e => (
                                    <option key={e.id} value={e.id}>{e.name} ({e.type})</option>
                                ))}
                            </select>
                        </div>

                        {selectedEpreuve && (
                            <>
                                <div className="space-y-4 border-t border-gray-100 pt-4">
                                    <h3 className="font-semibold text-lg">Critères d&apos;évaluation</h3>
                                    {questions.length === 0 && <p className="text-sm text-gray-500 italic">Aucun critère défini pour cette épreuve.</p>}

                                    {questions.map((q: any, idx: number) => (
                                        <div key={idx} className="grid grid-cols-[1fr_100px] gap-4 items-center">
                                            <Label>{q.q || q.question} <span className="text-xs text-gray-400">(Coeff. {q.weight || q.maxScore || 1})</span></Label>
                                            <Input
                                                type="number"
                                                min="0"
                                                placeholder="Points"
                                                required
                                                onChange={e => handleScoreChange(idx, e.target.value)}
                                            />
                                        </div>
                                    ))}
                                </div>

                                <div className="space-y-2">
                                    <Label>Commentaire global</Label>
                                    <textarea
                                        className="w-full p-2 border rounded-md"
                                        rows={4}
                                        value={formData.comment}
                                        onChange={e => setFormData({ ...formData, comment: e.target.value })}
                                        placeholder="Notez vos observations..."
                                    />
                                </div>

                                <Button type="submit" className="w-full">Enregistrer l&apos;évaluation</Button>
                            </>
                        )}
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
