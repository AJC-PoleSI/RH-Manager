"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Trash2, X, Eye, EyeOff } from 'lucide-react';
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
        roulement_minutes: 10,
        date_debut: '',
        date_fin: '',
        is_pole_test: false,
        pole: 'None',
        description: '',
    });
    const [questions, setQuestions] = useState<{ q: string; weight: number }[]>([{ q: '', weight: 1 }]);
    const { toast } = useToast();

    // Phase 3 — Filtres
    const [filterTour, setFilterTour] = useState<string>('all');
    const [filterType, setFilterType] = useState<string>('all');

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
            roulement_minutes: epreuve.roulementMinutes || 10,
            date_debut: epreuve.dateDebut || '',
            date_fin: epreuve.dateFin || '',
            is_pole_test: epreuve.isPoleTest,
            pole: epreuve.pole || 'None',
            description: epreuve.description || '',
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
            roulement_minutes: 10,
            date_debut: '',
            date_fin: '',
            is_pole_test: false,
            pole: 'None',
            description: '',
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
            roulementMinutes: formData.roulement_minutes,
            dateDebut: formData.date_debut || null,
            dateFin: formData.date_fin || null,
            isPoleTest: formData.is_pole_test,
            pole: formData.pole,
            description: formData.description || null,
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

    const handleDelete = async (id: string) => {
        if (window.confirm("Êtes-vous sûr de vouloir supprimer cette épreuve ?")) {
            try {
                await api.delete(`/epreuves/${id}`);
                setViewingEpreuve(null);
                fetchEpreuves();
            } catch (error) {
                console.error("Erreur lors de la suppression:", error);
                toast("Erreur lors de la suppression de l'épreuve", 'error');
            }
        }
    };

    // Phase 4 — Toggle visibility
    const handleToggleVisibility = async (epreuve: any) => {
        const newVal = !(epreuve.isVisible !== false);
        try {
            await api.put(`/epreuves/${epreuve.id}`, { isVisible: newVal });
            fetchEpreuves();
            toast(newVal ? 'Épreuve rendue visible' : 'Épreuve masquée', 'success');
        } catch (error) {
            console.error(error);
            toast("Erreur lors du changement de visibilité", 'error');
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
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setViewingEpreuve(null)}>
                    <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>{viewingEpreuve.name}</CardTitle>
                                <p className="text-sm text-gray-500 mt-1">
                                    {viewingEpreuve.type} • {viewingEpreuve.durationMinutes}min + {viewingEpreuve.roulementMinutes || 10}min roulement • Tour {viewingEpreuve.tour}
                                </p>
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
                            <div className="flex justify-end gap-2 pt-4 border-t">
                                <Button variant="danger" onClick={() => handleDelete(viewingEpreuve.id)}>Supprimer</Button>
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
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>Tour</Label>
                                    <select
                                        value={formData.tour}
                                        onChange={e => setFormData({ ...formData, tour: parseInt(e.target.value) })}
                                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                    >
                                        <option value={1}>Tour 1</option>
                                        <option value={2}>Tour 2</option>
                                        <option value={3}>Tour 3</option>
                                    </select>
                                </div>
                                <div>
                                    <Label>Type</Label>
                                    <select
                                        value={formData.type}
                                        onChange={e => setFormData({ ...formData, type: e.target.value })}
                                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                    >
                                        <option value="Entretien">Entretien</option>
                                        <option value="commune">Sur table (commune)</option>
                                        <option value="individuelle">Individuelle</option>
                                        <option value="groupe">Groupe</option>
                                        <option value="oral">Oral</option>
                                        <option value="business_game">Business Game</option>
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>Épreuve de pôle</Label>
                                    <div className="flex items-center gap-3 mt-1">
                                        <input
                                            type="checkbox"
                                            checked={formData.is_pole_test}
                                            onChange={e => setFormData({ ...formData, is_pole_test: e.target.checked, pole: e.target.checked ? formData.pole : 'None' })}
                                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        <span className="text-sm text-gray-600">Oui, c&apos;est une épreuve de pôle</span>
                                    </div>
                                </div>
                                {formData.is_pole_test && (
                                    <div>
                                        <Label>Pôle</Label>
                                        <select
                                            value={formData.pole}
                                            onChange={e => setFormData({ ...formData, pole: e.target.value })}
                                            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                        >
                                            <option value="None">-- Sélectionner --</option>
                                            <option value="Système d'information">Système d&apos;information</option>
                                            <option value="Marketing">Marketing</option>
                                            <option value="Développement commercial">Développement commercial</option>
                                            <option value="Audit Qualité">Audit Qualité</option>
                                            <option value="Ressource Humaine">Ressource Humaine</option>
                                            <option value="Trésorerie">Trésorerie</option>
                                            <option value="Bureau - VP">Bureau - VP</option>
                                            <option value="Bureau - Président">Bureau - Président</option>
                                            <option value="Bureau - Trésorier">Bureau - Trésorier</option>
                                            <option value="Bureau - Secrétaire générale">Bureau - Secrétaire générale</option>
                                        </select>
                                    </div>
                                )}
                            </div>

                            {/* Description */}
                            <div>
                                <Label>Description (visible par les candidats)</Label>
                                <textarea
                                    value={formData.description}
                                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]"
                                    placeholder="Décrivez brièvement l'épreuve, ses objectifs, ce que le candidat doit préparer..."
                                />
                            </div>

                            {/* Planning configuration */}
                            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 space-y-4">
                                <h3 className="text-sm font-bold text-blue-800">Configuration Planning</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label className="text-xs">Roulement (min)</Label>
                                        <Input type="number" min={0} value={formData.roulement_minutes} onChange={e => setFormData({ ...formData, roulement_minutes: parseInt(e.target.value) || 0 })} />
                                        <p className="text-[10px] text-gray-500 mt-0.5">Pause entre passages</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label className="text-xs">Date de début</Label>
                                        <Input type="date" value={formData.date_debut} onChange={e => setFormData({ ...formData, date_debut: e.target.value })} />
                                    </div>
                                    <div>
                                        <Label className="text-xs">Date de fin</Label>
                                        <Input type="date" value={formData.date_fin} onChange={e => setFormData({ ...formData, date_fin: e.target.value })} />
                                    </div>
                                </div>
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

            {/* Phase 3 — Filtres Tour / Type */}
            <div className="flex gap-3 items-center flex-wrap bg-white border border-gray-200 rounded-xl p-3">
                <span className="text-sm font-medium text-gray-600">Filtres :</span>
                <select
                    value={filterTour}
                    onChange={e => setFilterTour(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="all">Tous les tours</option>
                    <option value="1">Tour 1</option>
                    <option value="2">Tour 2</option>
                    <option value="3">Tour 3</option>
                </select>
                <select
                    value={filterType}
                    onChange={e => setFilterType(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="all">Tous les types</option>
                    <option value="Entretien">Entretien</option>
                    <option value="commune">Sur table (commune)</option>
                    <option value="individuelle">Individuelle</option>
                    <option value="groupe">Groupe</option>
                    <option value="oral">Oral</option>
                    <option value="business_game">Business Game</option>
                </select>
                {(filterTour !== 'all' || filterType !== 'all') && (
                    <button
                        onClick={() => { setFilterTour('all'); setFilterType('all'); }}
                        className="text-xs text-gray-500 hover:text-red-500 underline"
                    >
                        Réinitialiser
                    </button>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {epreuves
                    .filter((epreuve: any) => filterTour === 'all' || String(epreuve.tour) === filterTour)
                    .filter((epreuve: any) => filterType === 'all' || epreuve.type === filterType)
                    .map((epreuve: any) => {
                    const isVisible = epreuve.isVisible !== false;
                    return (
                    <Card
                        key={epreuve.id}
                        className={`group hover:shadow-md transition-shadow cursor-pointer hover:border-primary-200 ${!isVisible ? 'opacity-60 border-dashed' : ''}`}
                        onClick={() => handleView(epreuve)}
                    >
                        <CardHeader>
                            <div className="flex justify-between items-start">
                                <CardTitle className="text-lg">{epreuve.name}</CardTitle>
                                <div className="flex items-center gap-2">
                                    {/* Phase 4 — Visibility toggle */}
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleToggleVisibility(epreuve); }}
                                        title={isVisible ? 'Visible (cliquer pour masquer)' : 'Masqué (cliquer pour rendre visible)'}
                                        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all hover:scale-110 ${
                                            isVisible
                                                ? 'border-green-400 bg-white hover:border-green-600'
                                                : 'border-gray-400 bg-gray-800 hover:border-gray-600'
                                        }`}
                                    >
                                        {isVisible
                                            ? <Eye size={12} className="text-green-600" />
                                            : <EyeOff size={12} className="text-gray-200" />
                                        }
                                    </button>
                                    <span className="bg-primary-100 text-primary-700 text-xs px-2 py-1 rounded font-bold">Tour {epreuve.tour}</span>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-gray-500 mb-4">
                                {epreuve.type} • {epreuve.durationMinutes} min
                                {!isVisible && <span className="ml-2 text-xs text-red-500 font-medium">• Masqué</span>}
                            </p>
                            <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); handleEdit(epreuve); }}>Modifier</Button>
                            </div>
                        </CardContent>
                    </Card>
                    );
                })}
            </div>
        </div>
    );
}
