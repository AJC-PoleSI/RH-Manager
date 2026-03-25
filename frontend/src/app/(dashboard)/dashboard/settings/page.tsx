"use client";

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'; // Assuming we have or can emulate
import { Plus, Trash2, Calendar, UserPlus } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/context/SettingsContext';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';

export default function SettingsPage() {
    const { user, role } = useAuth();
    const { settings, updateSettings } = useSettings();
    const isAdmin = role === 'member' && user?.isAdmin;
    const { toast } = useToast();

    // Local state for forms
    const [localSettings, setLocalSettings] = useState(settings);
    const [saving, setSaving] = useState(false);

    // Deadline state
    const [deadlineCandidats, setDeadlineCandidats] = useState('');
    const [deadlineMembres, setDeadlineMembres] = useState('');
    const [savingDeadlines, setSavingDeadlines] = useState(false);

    // Load deadlines from settings
    useEffect(() => {
        const loadDeadlines = async () => {
            try {
                const res = await api.get('/settings');
                if (res.data.deadline_candidats) setDeadlineCandidats(res.data.deadline_candidats);
                if (res.data.deadline_membres) setDeadlineMembres(res.data.deadline_membres);
            } catch (e) { console.error(e); }
        };
        loadDeadlines();
    }, []);

    const handleSaveDeadlines = async () => {
        setSavingDeadlines(true);
        try {
            await api.put('/settings', {
                deadline_candidats: deadlineCandidats,
                deadline_membres: deadlineMembres
            });
            toast('Deadlines enregistr\u00e9es', 'success');
        } catch (e) {
            toast('Erreur lors de la sauvegarde des deadlines', 'error');
        } finally {
            setSavingDeadlines(false);
        }
    };

    // Sync context to local state when loaded
    useEffect(() => {
        setLocalSettings(settings);
    }, [settings]);

    const handleSaveSettings = async () => {
        setSaving(true);
        try {
            await updateSettings(localSettings);
            toast("Paramètres enregistrés", 'success');
        } catch (e) {
            toast("Erreur lors de la sauvegarde", 'error');
        } finally {
            setSaving(false);
        }
    };

    // Calendar & Events Logic
    const [events, setEvents] = useState<any[]>([]);
    const [editingEvent, setEditingEvent] = useState<any>(null);
    const [loadingEvents, setLoadingEvents] = useState(false);

    // Member Management State
    const [members, setMembers] = useState<any[]>([]);
    const [newMember, setNewMember] = useState({ email: '', password: '', isAdmin: false });
    const [loadingMembers, setLoadingMembers] = useState(false);

    useEffect(() => {
        if (isAdmin) fetchMembers();
    }, [isAdmin]);

    const fetchMembers = async () => {
        setLoadingMembers(true);
        try {
            const res = await api.get('/members');
            setMembers(res.data);
        } catch (e) { console.error(e); } finally { setLoadingMembers(false); }
    };

    const handleCreateMember = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.post('/members', newMember);
            setNewMember({ email: '', password: '', isAdmin: false });
            toast('Membre ajouté', 'success');
            fetchMembers();
        } catch (e) { toast('Erreur création', 'error'); }
    };

    const handleDeleteMember = async (id: string) => {
        if (!confirm('Supprimer ce membre ?')) return;
        try {
            await api.delete(`/members/${id}`);
            fetchMembers();
        } catch (e) { toast('Erreur suppression', 'error'); }
    };

    // Initial fetch of events
    useEffect(() => {
        fetchEvents();
    }, []);

    const fetchEvents = async () => {
        setLoadingEvents(true);
        try {
            const res = await api.get('/calendar');
            setEvents(res.data);
        } catch (e) { console.error(e); } finally { setLoadingEvents(false); }
    };

    const handleDeleteEvent = async (id: string) => {
        if (!confirm('Supprimer cet événement ?')) return;
        try {
            await api.delete(`/calendar/${id}`);
            fetchEvents();
        } catch (e) { toast('Erreur suppression', 'error'); }
    };

    // Simple Event Form Component (inline for now)
    const EventForm = () => {
        const [formData, setFormData] = useState(editingEvent || {
            title: '', description: '', day: new Date().toISOString().split('T')[0], startTime: '09:00', endTime: '10:00'
        });

        const handleSubmit = async (e: React.FormEvent) => {
            e.preventDefault();
            try {
                if (editingEvent) {
                    await api.put(`/calendar/${editingEvent.id}`, formData);
                } else {
                    await api.post('/calendar', formData);
                }
                setEditingEvent(null);
                fetchEvents();
            } catch (err) { toast('Erreur sauvegarde', 'error'); }
        };

        return (
            <form onSubmit={handleSubmit} className="border p-4 rounded-lg space-y-3 bg-gray-50 mb-4">
                <h3 className="font-bold">{editingEvent ? 'Modifier' : 'Nouvel'} Événement</h3>
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1"><Label>Titre</Label><Input value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} required /></div>
                    <div className="space-y-1"><Label>Date</Label><Input type="date" value={formData.day.split('T')[0]} onChange={e => setFormData({ ...formData, day: e.target.value })} required /></div>
                    <div className="space-y-1"><Label>Début</Label><Input type="time" value={formData.startTime} onChange={e => setFormData({ ...formData, startTime: e.target.value })} required /></div>
                    <div className="space-y-1"><Label>Fin</Label><Input type="time" value={formData.endTime} onChange={e => setFormData({ ...formData, endTime: e.target.value })} required /></div>
                    <div className="col-span-2 space-y-1"><Label>Description</Label><Input value={formData.description || ''} onChange={e => setFormData({ ...formData, description: e.target.value })} /></div>
                </div>
                <div className="flex gap-2 justify-end">
                    <Button type="button" variant="ghost" onClick={() => setEditingEvent(null)}>Annuler</Button>
                    <Button type="submit">Enregistrer</Button>
                </div>
            </form>
        );
    };

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold">Paramètres</h1>

            <Tabs defaultValue="deadlines" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="deadlines">Deadlines</TabsTrigger>
                    <TabsTrigger value="members">Membres</TabsTrigger>
                    {isAdmin && <TabsTrigger value="availabilities">Horaires Disponibilités</TabsTrigger>}
                    <TabsTrigger value="calendar">Calendrier Global</TabsTrigger>
                </TabsList>

                <TabsContent value="deadlines" className="space-y-4 mt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Échéances</CardTitle>
                            <CardDescription>Gérez les dates limites pour les membres et candidats.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-2">
                                <Label>Deadline inscription aux épreuves (Candidats)</Label>
                                <Input
                                    type="date"
                                    value={deadlineCandidats}
                                    onChange={e => setDeadlineCandidats(e.target.value)}
                                />
                                {deadlineCandidats && (
                                    <p className="text-xs text-gray-500">
                                        {new Date(deadlineCandidats) < new Date()
                                            ? <span className="text-red-500 font-medium">⚠ Cette deadline est dépassée</span>
                                            : <span className="text-green-600">✓ Active</span>
                                        }
                                    </p>
                                )}
                            </div>
                            <div className="grid gap-2">
                                <Label>Deadline saisie des disponibilités (Membres)</Label>
                                <Input
                                    type="date"
                                    value={deadlineMembres}
                                    onChange={e => setDeadlineMembres(e.target.value)}
                                />
                                {deadlineMembres && (
                                    <p className="text-xs text-gray-500">
                                        {new Date(deadlineMembres) < new Date()
                                            ? <span className="text-red-500 font-medium">⚠ Cette deadline est dépassée</span>
                                            : <span className="text-green-600">✓ Active</span>
                                        }
                                    </p>
                                )}
                            </div>
                            <Button onClick={handleSaveDeadlines} disabled={savingDeadlines}>
                                {savingDeadlines ? 'Sauvegarde...' : 'Sauvegarder'}
                            </Button>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="members" className="space-y-4 mt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Gestion des Membres</CardTitle>
                            <CardDescription>Ajoutez ou supprimez des membres du staff.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-4">
                                <form onSubmit={handleCreateMember} className="flex gap-4 items-end bg-gray-50 p-4 rounded-lg">
                                    <div className="flex-1 space-y-2">
                                        <Label>Email</Label>
                                        <Input
                                            type="email"
                                            required
                                            value={newMember.email}
                                            onChange={e => setNewMember({ ...newMember, email: e.target.value })}
                                            placeholder="email@essec.edu"
                                        />
                                    </div>
                                    <div className="flex-1 space-y-2">
                                        <Label>Mot de passe</Label>
                                        <Input
                                            type="password"
                                            required
                                            value={newMember.password}
                                            onChange={e => setNewMember({ ...newMember, password: e.target.value })}
                                            placeholder="******"
                                        />
                                    </div>
                                    <div className="flex items-center gap-2 pb-3">
                                        <input
                                            type="checkbox"
                                            id="isAdmin"
                                            checked={newMember.isAdmin}
                                            onChange={e => setNewMember({ ...newMember, isAdmin: e.target.checked })}
                                            className="h-4 w-4"
                                        />
                                        <Label htmlFor="isAdmin" className="mb-0">Admin</Label>
                                    </div>
                                    <Button type="submit"><UserPlus className="mr-2" size={16} /> Ajouter</Button>
                                </form>

                                <div className="border rounded-md overflow-hidden">
                                    <table className="w-full text-sm text-left">
                                        <thead className="bg-gray-100 uppercase text-xs">
                                            <tr>
                                                <th className="px-4 py-3">Email</th>
                                                <th className="px-4 py-3">Rôle</th>
                                                <th className="px-4 py-3 text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {members.map((m) => (
                                                <tr key={m.id} className="hover:bg-gray-50">
                                                    <td className="px-4 py-3 font-medium">{m.email}</td>
                                                    <td className="px-4 py-3">
                                                        {m.isAdmin ? <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded text-xs font-bold">Admin</span> : <span className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs">Membre</span>}
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        <Button variant="ghost" size="sm" className="text-red-500" onClick={() => handleDeleteMember(m.id)}>
                                                            <Trash2 size={16} />
                                                        </Button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {loadingMembers && <div className="p-4 text-center text-gray-400">Chargement...</div>}
                                    {!loadingMembers && members.length === 0 && <div className="p-4 text-center text-gray-400">Aucun membre</div>}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {isAdmin && (
                    <TabsContent value="availabilities" className="space-y-4 mt-4">
                        <Card>
                            <CardHeader>
                                <CardTitle>Configuration des Plages Horaires</CardTitle>
                                <CardDescription>Définissez les créneaux standards.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-6">
                                    <div className="space-y-4">
                                        <Label className="text-lg font-semibold">Horaires d'ouverture par jour</Label>
                                        <p className="text-sm text-gray-500">Décochez la case pour fermer le jour (aucun créneau possible).</p>

                                        {[
                                            { key: 'mon', label: 'Lundi' },
                                            { key: 'tue', label: 'Mardi' },
                                            { key: 'wed', label: 'Mercredi' },
                                            { key: 'thu', label: 'Jeudi' },
                                            { key: 'fri', label: 'Vendredi' },
                                            { key: 'sat', label: 'Samedi' },
                                            { key: 'sun', label: 'Dimanche' },
                                        ].map((day) => {
                                            const dayConfig = localSettings.weeklySchedule?.[day.key] || { start: 8, end: 19, isOpen: true };
                                            return (
                                                <div key={day.key} className="flex items-center gap-4 p-2 rounded hover:bg-gray-50">
                                                    <div className="flex items-center gap-3 w-32">
                                                        <input
                                                            type="checkbox"
                                                            checked={dayConfig.isOpen}
                                                            onChange={(e) => {
                                                                const newVal = e.target.checked;
                                                                setLocalSettings((prev: any) => ({
                                                                    ...prev,
                                                                    weeklySchedule: {
                                                                        ...prev.weeklySchedule,
                                                                        [day.key]: { ...dayConfig, isOpen: newVal }
                                                                    }
                                                                }));
                                                            }}
                                                            className="w-4 h-4 rounded border-gray-300"
                                                        />
                                                        <span className={dayConfig.isOpen ? "font-medium" : "text-gray-400"}>{day.label}</span>
                                                    </div>

                                                    {dayConfig.isOpen ? (
                                                        <div className="flex items-center gap-2">
                                                            <Input
                                                                type="number"
                                                                className="w-20"
                                                                value={dayConfig.start}
                                                                onChange={(e) => {
                                                                    setLocalSettings((prev: any) => ({
                                                                        ...prev,
                                                                        weeklySchedule: {
                                                                            ...prev.weeklySchedule,
                                                                            [day.key]: { ...dayConfig, start: parseInt(e.target.value) }
                                                                        }
                                                                    }));
                                                                }}
                                                                min="0"
                                                                max="23"
                                                            />
                                                            <span>à</span>
                                                            <Input
                                                                type="number"
                                                                className="w-20"
                                                                value={dayConfig.end}
                                                                onChange={(e) => {
                                                                    setLocalSettings((prev: any) => ({
                                                                        ...prev,
                                                                        weeklySchedule: {
                                                                            ...prev.weeklySchedule,
                                                                            [day.key]: { ...dayConfig, end: parseInt(e.target.value) }
                                                                        }
                                                                    }));
                                                                }}
                                                                min="0"
                                                                max="23"
                                                            />
                                                        </div>
                                                    ) : (
                                                        <span className="text-sm text-gray-400 italic">Fermé</span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <div className="space-y-2 pt-4 border-t">
                                        <Label>Durée des créneaux (minutes)</Label>
                                        <select
                                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                            value={localSettings.slotDuration}
                                            onChange={e => setLocalSettings({ ...localSettings, slotDuration: parseInt(e.target.value) })}
                                        >
                                            <option value="15">15 minutes</option>
                                            <option value="30">30 minutes</option>
                                            <option value="45">45 minutes</option>
                                            <option value="60">1 heure</option>
                                        </select>
                                    </div>
                                    <Button className="mt-4" onClick={handleSaveSettings} disabled={saving}>{saving ? 'Sauvegarde...' : 'Mettre à jour'}</Button>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}

                <TabsContent value="calendar" className="space-y-4 mt-4">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>Événements du Tableau de Bord</CardTitle>
                                <CardDescription>Ajoutez, modifiez ou supprimez des événements globaux.</CardDescription>
                            </div>
                            <Button onClick={() => setEditingEvent({})}>+ Nouvel Événement</Button>
                        </CardHeader>
                        <CardContent>
                            {editingEvent && <EventForm />}

                            <div className="border rounded-md overflow-hidden">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-gray-100 uppercase text-xs">
                                        <tr>
                                            <th className="px-4 py-3">Titre</th>
                                            <th className="px-4 py-3">Date</th>
                                            <th className="px-4 py-3">Heure</th>
                                            <th className="px-4 py-3 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {events.map((evt) => (
                                            <tr key={evt.id} className="hover:bg-gray-50">
                                                <td className="px-4 py-3 font-medium">{evt.title}</td>
                                                <td className="px-4 py-3">{evt.day.split('T')[0]}</td>
                                                <td className="px-4 py-3">{evt.startTime} - {evt.endTime}</td>
                                                <td className="px-4 py-3 text-right space-x-2">
                                                    <Button variant="ghost" size="sm" onClick={() => setEditingEvent(evt)}>Modifier</Button>
                                                    <Button variant="ghost" size="sm" className="text-red-500" onClick={() => handleDeleteEvent(evt.id)}><Trash2 size={16} /></Button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {loadingEvents && <div className="p-4 text-center text-gray-400">Chargement...</div>}
                                {!loadingEvents && events.length === 0 && <div className="p-4 text-center text-gray-400">Aucun événement</div>}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
