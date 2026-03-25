"use client";

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export default function CandidateEpreuvesPage() {
    const [epreuves, setEpreuves] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchEpreuves = async () => {
            try {
                const res = await api.get('/epreuves');
                setEpreuves(res.data);
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchEpreuves();
    }, []);

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold">Liste des Épreuves</h1>
            <p className="text-gray-500">Voici les épreuves disponibles pour votre parcours.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {loading ? (
                    <p>Chargement...</p>
                ) : (
                    epreuves.map((epreuve: any) => (
                        <Card key={epreuve.id} className="hover:shadow-md transition-shadow">
                            <CardHeader>
                                <div className="flex justify-between items-start">
                                    <CardTitle className="text-lg">{epreuve.name}</CardTitle>
                                    <span className="bg-primary-100 text-primary-700 text-xs px-2 py-1 rounded-full font-bold">
                                        Tour {epreuve.tour}
                                    </span>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-500">Type</span>
                                        <span className="font-medium">{epreuve.type}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-500">Durée</span>
                                        <span className="font-medium">{epreuve.durationMinutes} min</span>
                                    </div>
                                    <div className="mt-4 pt-4 border-t border-gray-100 text-center text-sm text-gray-500 italic">
                                        {epreuve.evaluation_questions ? "Critères définis" : "Aucun critère"}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </div>
    );
}
