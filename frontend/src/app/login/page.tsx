"use client";

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import api from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export default function LoginPage() {
    const [isMember, setIsMember] = useState(true);
    const [isRegistering, setIsRegistering] = useState(false);
    const { loginMember, loginCandidate } = useAuth();
    const [formData, setFormData] = useState({
        email: '',
        password: '',
        first_name: '',
        last_name: '',
        phone: '',
    });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const resetForm = () => {
        setFormData({ email: '', password: '', first_name: '', last_name: '', phone: '' });
        setError('');
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (isMember) {
                const res = await api.post('/auth/login', {
                    email: formData.email,
                    password: formData.password,
                });
                loginMember(res.data.token, res.data.member);
            } else if (isRegistering) {
                // Use public registration endpoint (no auth required)
                const res = await api.post('/auth/register-candidate', {
                    firstName: formData.first_name,
                    lastName: formData.last_name,
                    email: formData.email,
                    phone: formData.phone,
                });
                loginCandidate(res.data.token, res.data.candidate);
            } else {
                const res = await api.post('/auth/candidate-login', {
                    email: formData.email,
                    lastName: formData.last_name,
                });
                loginCandidate(res.data.token, res.data.candidate);
            }
        } catch (err: any) {
            console.error("Login error:", err);
            if (!err.response) {
                setError("Impossible de contacter le serveur. Vérifiez qu'il est lancé sur le port 4000.");
            } else {
                setError(err.response?.data?.error || 'Une erreur est survenue');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
            <Card className="w-full max-w-md">
                <CardHeader className="space-y-1">
                    <CardTitle className="text-2xl font-bold text-center text-primary-900">RH Manager</CardTitle>
                    <CardDescription className="text-center">
                        Connectez-vous à votre espace
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-1 justify-center mb-6 bg-gray-100 p-1 rounded-lg">
                        <button
                            className={cn("flex-1 py-2 text-sm font-medium rounded-md transition-all duration-200", isMember ? "bg-white text-primary-600 shadow-sm" : "text-gray-500 hover:text-gray-900 hover:bg-gray-200/50")}
                            onClick={() => { setIsMember(true); resetForm(); }}
                        >
                            Membre
                        </button>
                        <button
                            className={cn("flex-1 py-2 text-sm font-medium rounded-md transition-all duration-200", !isMember ? "bg-white text-primary-600 shadow-sm" : "text-gray-500 hover:text-gray-900 hover:bg-gray-200/50")}
                            onClick={() => { setIsMember(false); setIsRegistering(false); resetForm(); }}
                        >
                            Candidat
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {error && <div className="text-red-500 text-sm text-center">{error}</div>}

                        {isMember ? (
                            <>
                                <div className="space-y-2">
                                    <Label htmlFor="email">Email</Label>
                                    <Input id="email" name="email" type="email" required value={formData.email} onChange={handleChange} placeholder="nom@exemple.com" />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="password">Mot de passe</Label>
                                    <Input id="password" name="password" type="password" required value={formData.password} onChange={handleChange} />
                                </div>
                            </>
                        ) : (
                            <>
                                {isRegistering ? (
                                    <>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label htmlFor="first_name">Prénom</Label>
                                                <Input id="first_name" name="first_name" required value={formData.first_name} onChange={handleChange} />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="last_name">Nom</Label>
                                                <Input id="last_name" name="last_name" required value={formData.last_name} onChange={handleChange} />
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="email">Email</Label>
                                            <Input id="email" name="email" type="email" required value={formData.email} onChange={handleChange} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="phone">Téléphone</Label>
                                            <Input id="phone" name="phone" value={formData.phone} onChange={handleChange} />
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="space-y-2">
                                            <Label htmlFor="email">Email</Label>
                                            <Input id="email" name="email" type="email" required value={formData.email} onChange={handleChange} placeholder="nom@exemple.com" />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="last_name">Nom de famille</Label>
                                            <Input id="last_name" name="last_name" required value={formData.last_name} onChange={handleChange} placeholder="ex: Dupont" />
                                        </div>
                                    </>
                                )}
                            </>
                        )}

                        <Button type="submit" className="w-full" disabled={loading}>
                            {loading ? 'Chargement...' : (isMember ? 'Se connecter' : (isRegistering ? "S'inscrire" : 'Se connecter'))}
                        </Button>
                    </form>
                </CardContent>
                <CardFooter className="justify-center">
                    {!isMember && (
                        <button
                            type="button"
                            className="text-sm text-primary-600 hover:underline"
                            onClick={() => { setIsRegistering(!isRegistering); resetForm(); }}
                        >
                            {isRegistering ? "J'ai déjà un compte" : "Je veux m'inscrire"}
                        </button>
                    )}
                </CardFooter>
            </Card>
        </div>
    );
}
