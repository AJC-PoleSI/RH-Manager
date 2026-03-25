"use client";

import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import api from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';

export default function EpreuvesPage() {
    const [epreuves, setEpreuves] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        tour: 1,
        type: 'Entretien',
        duration_minutes: 30,
        is_pole_test: false,
        pole: 'None'
    });
    const [questions, setQuestions] = useState<{ q: string; weight: number }[]>([{ q: '', weight: 1 }]);
    const { toast } = useToast();

    useEffect(() => {
        fetchEpreuves();
    }, []);

    const fetchEpreuves = async () => {
        try {
            const res = await api.get('/epreuves');
            setEpreuves(res.data);
        } catch (e) { console.error(e); }
    };

    const [viewingEpreuve, setViewingEpreuve] = useState<any>(null);

    const handleView = (epreuve: any) => {
        setViewingEpreuve(epreuve);
    };

    const handleEdit = (epreuve: any) => {
        setEditingId(epreuve.id);
        setFormData({
            name: epreuve.name,
            tour: epreuve.tour,
            type: epreuve.type,
            duration_minutes: epreuve.durationMinutes,
            is_pole_test: epreuve.isPoleTest,
            pole: epreuve.pole || 'None'
        });

        try {
            const parsedQuestions = typeof epreuve.evaluationQuestions === 'string'
                ? JSON.parse(epreuve.evaluationQuestions)
                : epreuve.evaluationQuestions;
            setQuestions(Array.isArray(parsedQuestions) ? parsedQuestions : [{ q: '', weight: 1 }]);
        } catch (e) {
            setQuestions([{ q: '', weight: 1 }]);
        }
        setShowForm(true);
    };

    const handleAddQuestion = () => {
        setQuestions([...questions, { q: '', weight: 1 }]);
    };

    const handleRemoveQuestion = (index: number) => {
        if (questions.length > 1) {
            setQuestions(questions.filter((_, i) => i !== index));
        }
    };

    const handleQuestionChange = (index: number, field: 'q' | 'weight', value: string | number) => {
        const updated = [...questions];
        updated[index] = { ...updated[index], [field]: value };
        setQuestions(updated);
    };

    const resetForm = () => {
        setFormData({
            name: '',
            tour: 1,
            type: 'Entretien',
            duration_minutes: 30,
            is_pole_test: false,
            pole: 'None'
        });
        setQuestions([{ q: '', weight: 1 }]);
        setEditingId(null);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const payload = {
            name: formData.name,
            tour: formData.tour,
            type: formData.type,
            durationMinutes: formData.duration_minutes,
            isPoleTest: formData.is_pole_test,
            pole: formData.pole,
            evaluationQuestions: questions
        };

        try {
            if (editingId) {
                await api.put(`/epreuves/${editingId}`, payload);
            } else {
                await api.post('/epreuves', payload);
            }
            setShowForm(false);
            resetForm();
            fetchEpreuves();
        } catch (error) {
            console.error(error);
            toast("Erreur lors de l'enregistrement de l'épreuve", 'error');
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Épreuves</h1>
                <Button onClick={() => { resetForm(); setShowForm(!showForm); }}>
                    {showForm ? 'Annuler' : 'Créer une épreuve'}
                </Button>
            </div>

            {/* View Details Modal */}
            {viewingEpreuve && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>{viewingEpreuve.name}</CardTitle>
                                <p className="text-sm text-gray-500 mt-1">{viewingEpreuve.type} • {viewingEpreuve.durationMinutes} min • Tour {viewingEpreuve.tour}</p>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => setViewingEpreuve(null)}><X size={20} /></Button>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <h3 className="font-semibold mb-2">Critères d&apos;évaluation</h3>
                                <div className="space-y-2">
                                    {(() => {
                                        try {
                                            const questions = typeof viewingEpreuve.evaluationQuestions === 'string'
                                                ? JSON.parse(viewingEpreuve.evaluationQuestions)
                                                : viewingEpreuve.evaluationQuestions;
                                            return (Array.isArray(questions) ? questions : []).map((q: any, i: number) => (
                                                <div key={i} className="flex justifying-between p-2 bg-gray-50 rounded border text-sm">
                                                    <span className="flex-1">{q.q}</span>
                                                    <span className="font-bold text-gray-600 bg-gray-200 px-2 rounded">x{q.weight}</span>
                                                </div>
                                            ));
                                        } catch { return <p className="text-sm text-gray-400 italic">Aucun critère lisible.</p> }
                                    })()}
                                </div>
                            </div>
                            <div className="flex justify-end pt-4 border-t">
                                <Button onClick={() => { setViewingEpreuve(null); handleEdit(viewingEpreuve); }}>Modifier</Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {showForm && (
                // ... existing form card ...
                <Card className="mb-6 border-primary-100 shadow-lg">
                    <CardHeader><CardTitle>{editingId ? 'Modifier l\'épreuve' : 'Nouvelle Épreuve'}</CardTitle></CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-6">
                            {/* ... form fields ... */}
                            <div className="grid grid-cols-2 gap-4">
                                <div><Label>Nom</Label><Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} required /></div>
                                <div><Label>Durée (min)</Label><Input type="number" value={formData.duration_minutes} onChange={e => setFormData({ ...formData, duration_minutes: parseInt(e.target.value) })} /></div>
                            </div>
                            <div className="flex gap-4">
                                <div><Label>Tour</Label><Input type="number" max={3} min={1} value={formData.tour} onChange={e => setFormData({ ...formData, tour: parseInt(e.target.value) })} /></div>
                                <div><Label>Type</Label><Input value={formData.type} onChange={e => setFormData({ ...formData, type: e.target.value })} /></div>
                            </div>

                            {/* Questions Section */}
                            <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
                                <div className="flex justify-between items-center">
                                    <Label className="text-lg font-semibold">Critères d&apos;évaluation</Label>
                                    <Button type="button" variant="outline" size="sm" onClick={handleAddQuestion}>+ Ajouter un critère</Button>
                                </div>
                                {questions.map((q, index) => (
                                    <div key={index} className="flex gap-2 items-end">
                                        <div className="flex-1">
                                            <Label className="text-xs">Question / Critère</Label>
                                            <Input value={q.q} onChange={e => handleQuestionChange(index, 'q', e.target.value)} required placeholder="Ex: Aisance à l'oral" />
                                        </div>
                                        <div className="w-24">
                                            <Label className="text-xs">Coeff.</Label>
                                            <Input type="number" value={q.weight} onChange={e => handleQuestionChange(index, 'weight', parseInt(e.target.value))} min={1} />
                                        </div>
                                        <Button type="button" variant="ghost" className="text-red-500" onClick={() => handleRemoveQuestion(index)}><Trash2 size={16} /></Button>
                                    </div>
                                ))}
                            </div>

                            <div className="flex justify-end gap-2">
                                <Button type="button" variant="ghost" onClick={resetForm}>Annuler</Button>
                                <Button type="submit">Enregistrer</Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {epreuves.map((epreuve: any) => (
                    <Card
                        key={epreuve.id}
                        className="group hover:shadow-md transition-shadow cursor-pointer hover:border-primary-200"
                        onClick={() => handleView(epreuve)}
                    >
                        <CardHeader>
                            <div className="flex justify-between items-start">
                                <CardTitle className="text-lg">{epreuve.name}</CardTitle>
                                <span className="bg-primary-100 text-primary-700 text-xs px-2 py-1 rounded font-bold">Tour {epreuve.tour}</span>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-gray-500 mb-4">{epreuve.type} • {epreuve.durationMinutes} min</p>
                            <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); handleEdit(epreuve); }}>Modifier</Button>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}
