"use client";

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import api from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowUp, ArrowDown, Loader2, Check } from 'lucide-react';
import { useToast } from '@/components/ui/toast';

const POLES = ['Communication', 'Marketing', 'RH', 'SI', 'Finance'];

export default function CandidateWishesPage() {
    const { user } = useAuth();
    const [poles, setPoles] = useState<string[]>(POLES);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        if (!user?.id) return;
        const fetchWishes = async () => {
            try {
                const res = await api.get(`/wishes/${user.id}`);
                if (res.data.length > 0) {
                    const ordered = res.data
                        .sort((a: any, b: any) => a.rank - b.rank)
                        .map((w: any) => w.pole);
                    // Add any missing poles at the end
                    const remaining = POLES.filter(p => !ordered.includes(p));
                    setPoles([...ordered, ...remaining]);
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchWishes();
    }, [user?.id]);

    const moveUp = (index: number) => {
        if (index === 0) return;
        const updated = [...poles];
        [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
        setPoles(updated);
        setSaved(false);
    };

    const moveDown = (index: number) => {
        if (index === poles.length - 1) return;
        const updated = [...poles];
        [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
        setPoles(updated);
        setSaved(false);
    };

    const handleSave = async () => {
        if (!user?.id) return;
        setSaving(true);
        try {
            const wishes = poles.map((pole, index) => ({ pole, rank: index + 1 }));
            await api.put(`/wishes/${user.id}`, { wishes });
            setSaved(true);
        } catch (e) {
            console.error(e);
            toast("Erreur lors de la sauvegarde des voeux.", 'error');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center p-12">
                <Loader2 className="animate-spin text-primary-500" size={32} />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold">Mes Choix</h1>
                <p className="text-gray-500">Classez les pôles par ordre de préférence (1 = premier choix).</p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Classement des Pôles</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    {poles.map((pole, index) => (
                        <div
                            key={pole}
                            className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border hover:bg-gray-100 transition-colors"
                        >
                            <span className="w-8 h-8 flex items-center justify-center bg-primary-100 text-primary-700 rounded-full font-bold text-sm">
                                {index + 1}
                            </span>
                            <span className="flex-1 font-medium">{pole}</span>
                            <div className="flex gap-1">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => moveUp(index)}
                                    disabled={index === 0}
                                >
                                    <ArrowUp size={16} />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => moveDown(index)}
                                    disabled={index === poles.length - 1}
                                >
                                    <ArrowDown size={16} />
                                </Button>
                            </div>
                        </div>
                    ))}

                    <div className="flex justify-end pt-4">
                        <Button onClick={handleSave} disabled={saving}>
                            {saving ? (
                                <Loader2 className="animate-spin mr-2" size={16} />
                            ) : saved ? (
                                <Check className="mr-2" size={16} />
                            ) : null}
                            {saved ? 'Sauvegardé' : 'Sauvegarder mes choix'}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
