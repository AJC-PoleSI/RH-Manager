"use client";

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, ClipboardList } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface Evaluation {
    id: string;
    scores: Record<string, number>;
    comment?: string;
    createdAt: string;
    candidate: { firstName: string; lastName: string };
    epreuve: { name: string; tour: number; type: string };
}

export default function MyEvaluationsPage() {
    const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchEvaluations = async () => {
            try {
                const res = await api.get('/evaluations/my-evaluations');
                setEvaluations(res.data);
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchEvaluations();
    }, []);

    const getScoreTotal = (scores: Record<string, number>) => {
        const values = Object.values(scores);
        if (values.length === 0) return 0;
        return values.reduce((sum, v) => sum + v, 0);
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold">Mes Évaluations</h1>
                <p className="text-gray-500">Retrouvez ici l&apos;historique de vos évaluations.</p>
            </div>

            {loading ? (
                <div className="flex justify-center p-12">
                    <Loader2 className="animate-spin text-primary-500" size={32} />
                </div>
            ) : evaluations.length === 0 ? (
                <Card>
                    <CardContent className="p-12 text-center">
                        <ClipboardList className="mx-auto mb-4 text-gray-300" size={48} />
                        <p className="text-gray-500">Vous n&apos;avez encore soumis aucune évaluation.</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-4">
                    {evaluations.map((ev) => (
                        <Card key={ev.id} className="hover:shadow-md transition-shadow">
                            <CardHeader className="pb-2">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <CardTitle className="text-lg">
                                            {ev.candidate.firstName} {ev.candidate.lastName}
                                        </CardTitle>
                                        <p className="text-sm text-gray-500 mt-1">
                                            {ev.epreuve.name} - {ev.epreuve.type} - Tour {ev.epreuve.tour}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <span className="bg-primary-100 text-primary-700 text-xs px-2 py-1 rounded-full font-bold">
                                            Score: {getScoreTotal(ev.scores)}
                                        </span>
                                        <p className="text-xs text-gray-400 mt-1">
                                            {format(new Date(ev.createdAt), 'dd MMM yyyy HH:mm', { locale: fr })}
                                        </p>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="flex flex-wrap gap-2 mb-2">
                                    {Object.entries(ev.scores).map(([key, value]) => (
                                        <span key={key} className="text-xs bg-gray-100 px-2 py-1 rounded">
                                            {key}: <strong>{value}</strong>
                                        </span>
                                    ))}
                                </div>
                                {ev.comment && (
                                    <p className="text-sm text-gray-600 mt-2 italic border-l-2 border-gray-200 pl-3">
                                        {ev.comment}
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
