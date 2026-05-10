"use client";

import { useState, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import api from '@/lib/api';

type View = 'landing' | 'login' | 'candidate-choice' | 'candidate-login' | 'inscription';

export default function LoginPage() {
    const [view, setView] = useState<View>('landing');
    const [step, setStep] = useState(1);
    const { loginMember, loginCandidate } = useAuth();
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const cvInputRef = useRef<HTMLInputElement>(null);

    // Member login form
    const [memberEmail, setMemberEmail] = useState('');
    const [memberPassword, setMemberPassword] = useState('');

    // Candidate login form
    const [candidateLoginEmail, setCandidateLoginEmail] = useState('');
    const [candidateLoginDob, setCandidateLoginDob] = useState('');

    // Candidate registration form
    const [candidateData, setCandidateData] = useState({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        dateOfBirth: '',
        formation: '',
        etablissement: '',
        anneeIntegration: '',
    });
    const [cvFile, setCvFile] = useState<File | null>(null);

    const resetForms = () => {
        setMemberEmail('');
        setMemberPassword('');
        setCandidateLoginEmail('');
        setCandidateLoginDob('');
        setCandidateData({
            firstName: '',
            lastName: '',
            email: '',
            phone: '',
            dateOfBirth: '',
            formation: '',
            etablissement: '',
            anneeIntegration: '',
        });
        setCvFile(null);
        setError('');
        setStep(1);
    };

    const goToLanding = () => {
        resetForms();
        setView('landing');
    };

    const handleMemberLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const res = await api.post('/auth/login', {
                email: memberEmail,
                password: memberPassword,
            });
            loginMember(res.data.token, res.data.member);
        } catch (err: any) {
            if (!err.response) {
                setError("Impossible de contacter le serveur.");
            } else {
                setError(err.response?.data?.error || 'Une erreur est survenue');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleCandidateLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const res = await api.post('/auth/candidate-login', {
                email: candidateLoginEmail,
                dateOfBirth: candidateLoginDob,
            });
            loginCandidate(res.data.token, res.data.candidate);
        } catch (err: any) {
            if (!err.response) {
                setError("Impossible de contacter le serveur.");
            } else {
                setError(err.response?.data?.error || 'Email ou date de naissance incorrect(e)');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleCandidateRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const res = await api.post('/auth/register-candidate', {
                firstName: candidateData.firstName,
                lastName: candidateData.lastName,
                email: candidateData.email,
                phone: candidateData.phone,
                dateOfBirth: candidateData.dateOfBirth,
                formation: candidateData.formation,
                etablissement: candidateData.etablissement,
                anneeIntegration: candidateData.anneeIntegration,
            });
            loginCandidate(res.data.token, res.data.candidate);
        } catch (err: any) {
            if (!err.response) {
                setError("Impossible de contacter le serveur.");
            } else {
                setError(err.response?.data?.error || "Échec de l'inscription");
            }
        } finally {
            setLoading(false);
        }
    };

    const handleCandidateChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setCandidateData({ ...candidateData, [e.target.name]: e.target.value });
    };

    const stepLabels = ['Identité', 'Formation', 'Documents'];

    // ─── LANDING VIEW ──────────────────────────────────────────────
    if (view === 'landing') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white px-4">
                <div className="w-full max-w-2xl text-center">
                    <h1 className="text-3xl sm:text-4xl font-semibold text-gray-900 tracking-tight">
                        Audencia Junior Conseil
                    </h1>
                    <p className="mt-2 text-gray-500 text-base">
                        Plateforme de recrutement associatif 2025
                    </p>
                    <div className="mx-auto mt-4 mb-10 h-1 w-24 rounded-full bg-gradient-to-r from-blue-600 to-pink-500" />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        {/* Candidate card */}
                        <button
                            onClick={() => { resetForms(); setView('candidate-choice'); }}
                            className="group rounded-2xl border-2 border-transparent p-8 text-left transition-all duration-200 hover:shadow-lg hover:-translate-y-1"
                            style={{ backgroundColor: '#FFF0F3' }}
                        >
                            <div className="text-4xl mb-4">🎓</div>
                            <h2 className="text-lg font-semibold text-gray-900">Je suis candidat</h2>
                            <p className="mt-1 text-sm text-gray-500">
                                Créer mon compte ou me connecter
                            </p>
                            <span
                                className="mt-4 inline-block text-sm font-medium"
                                style={{ color: '#E8446A' }}
                            >
                                Accéder →
                            </span>
                        </button>

                        {/* Member card */}
                        <button
                            onClick={() => { resetForms(); setView('login'); }}
                            className="group rounded-2xl border-2 border-transparent p-8 text-left transition-all duration-200 hover:shadow-lg hover:-translate-y-1 bg-blue-50"
                        >
                            <div className="text-4xl mb-4">👥</div>
                            <h2 className="text-lg font-semibold text-gray-900">Membre JE / Admin</h2>
                            <p className="mt-1 text-sm text-gray-500">
                                Accéder à mon espace staff
                            </p>
                            <span className="mt-4 inline-block text-sm font-medium text-blue-600">
                                Se connecter →
                            </span>
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ─── CANDIDATE CHOICE VIEW ──────────────────────────────────────
    if (view === 'candidate-choice') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white px-4">
                <div className="w-full max-w-2xl text-center">
                    <h1 className="text-3xl font-semibold text-gray-900 tracking-tight">
                        Espace Candidat
                    </h1>
                    <p className="mt-2 text-gray-500 text-base">
                        Choisissez une option pour continuer
                    </p>
                    <div className="mx-auto mt-4 mb-10 h-1 w-24 rounded-full" style={{ backgroundColor: '#E8446A' }} />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        {/* Create account */}
                        <button
                            onClick={() => { resetForms(); setView('inscription'); }}
                            className="group rounded-2xl border-2 border-gray-200 p-8 text-left transition-all duration-200 hover:shadow-lg hover:-translate-y-1 hover:border-pink-200 bg-white"
                        >
                            <div className="text-4xl mb-4">📝</div>
                            <h2 className="text-lg font-semibold text-gray-900">Créer un compte</h2>
                            <p className="mt-1 text-sm text-gray-500">
                                Première fois ? Inscrivez-vous pour commencer votre parcours
                            </p>
                            <span className="mt-4 inline-block text-sm font-medium" style={{ color: '#E8446A' }}>
                                S&apos;inscrire →
                            </span>
                        </button>

                        {/* Login */}
                        <button
                            onClick={() => { resetForms(); setView('candidate-login'); }}
                            className="group rounded-2xl border-2 border-gray-200 p-8 text-left transition-all duration-200 hover:shadow-lg hover:-translate-y-1 hover:border-blue-200 bg-white"
                        >
                            <div className="text-4xl mb-4">🔑</div>
                            <h2 className="text-lg font-semibold text-gray-900">Se connecter</h2>
                            <p className="mt-1 text-sm text-gray-500">
                                Vous avez déjà un compte ? Connectez-vous avec votre email et date de naissance
                            </p>
                            <span className="mt-4 inline-block text-sm font-medium text-blue-600">
                                Connexion →
                            </span>
                        </button>
                    </div>

                    <div className="mt-8">
                        <button
                            onClick={goToLanding}
                            className="text-sm text-gray-500 hover:text-gray-700 transition"
                        >
                            ← Retour
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ─── CANDIDATE LOGIN ─────────────────────────────────────────────
    if (view === 'candidate-login') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-black/40 px-4">
                <div className="w-full max-w-[440px] bg-white rounded-xl shadow-2xl p-8">
                    <h1 className="text-xl font-semibold text-gray-900 text-center">Connexion Candidat</h2>
                    <p className="mt-1 text-sm text-gray-500 text-center">
                        Entrez votre email et date de naissance
                    </p>

                    {error && (
                        <div
                            className="mt-4 rounded-lg px-4 py-3 text-sm font-medium"
                            style={{ backgroundColor: '#FFF0F3', color: '#E8446A' }}
                        >
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleCandidateLogin} className="mt-6 space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Email
                            </label>
                            <input
                                type="email"
                                required
                                value={candidateLoginEmail}
                                onChange={(e) => setCandidateLoginEmail(e.target.value)}
                                placeholder="jean.dupont@ecole.fr"
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Date de naissance
                            </label>
                            <input
                                type="date"
                                required
                                value={candidateLoginDob}
                                onChange={(e) => setCandidateLoginDob(e.target.value)}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition disabled:opacity-50"
                            style={{ backgroundColor: '#E8446A' }}
                        >
                            {loading ? 'Connexion...' : 'Se connecter'}
                        </button>
                    </form>

                    <div className="mt-4 text-center space-y-2">
                        <p className="text-sm text-gray-500">
                            Pas encore de compte ?{' '}
                            <button
                                onClick={() => { resetForms(); setView('inscription'); }}
                                className="font-medium hover:underline"
                                style={{ color: '#E8446A' }}
                            >
                                Créer un compte
                            </button>
                        </p>
                        <button
                            onClick={() => setView('candidate-choice')}
                            className="text-sm text-gray-500 hover:text-gray-700 transition"
                        >
                            ← Retour
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ─── LOGIN MODAL (Member) ──────────────────────────────────────
    if (view === 'login') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-black/40 px-4">
                <div className="w-full max-w-[440px] bg-white rounded-xl shadow-2xl p-8">
                    <h1 className="text-xl font-semibold text-gray-900 text-center">Connexion Staff</h2>
                    <p className="mt-1 text-sm text-gray-500 text-center">
                        Entrez vos identifiants AJC
                    </p>

                    {error && (
                        <div
                            className="mt-4 rounded-lg px-4 py-3 text-sm font-medium"
                            style={{ backgroundColor: '#FFF0F3', color: '#E8446A' }}
                        >
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleMemberLogin} className="mt-6 space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Email
                            </label>
                            <input
                                type="email"
                                required
                                value={memberEmail}
                                onChange={(e) => setMemberEmail(e.target.value)}
                                placeholder="nom@audencia.com"
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Mot de passe
                            </label>
                            <input
                                type="password"
                                required
                                value={memberPassword}
                                onChange={(e) => setMemberPassword(e.target.value)}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition disabled:opacity-50"
                        >
                            {loading ? 'Connexion...' : 'Se connecter'}
                        </button>
                    </form>

                    <div className="mt-4 text-center">
                        <button
                            onClick={goToLanding}
                            className="text-sm text-gray-500 hover:text-gray-700 transition"
                        >
                            ← Retour
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ─── INSCRIPTION MODAL (Candidate) ─────────────────────────────
    return (
        <div className="min-h-screen flex items-center justify-center bg-black/40 px-4 py-8">
            <div className="w-full max-w-[520px] bg-white rounded-xl shadow-2xl p-8">
                <h1 className="text-xl font-semibold text-gray-900 text-center">Inscription Candidat</h2>

                {/* Progress bar */}
                <div className="mt-6 flex items-center justify-between">
                    {stepLabels.map((label, i) => {
                        const num = i + 1;
                        const isActive = step >= num;
                        return (
                            <div key={num} className="flex items-center flex-1">
                                <div className="flex flex-col items-center flex-1">
                                    <div
                                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition ${
                                            isActive
                                                ? 'bg-blue-600 text-white'
                                                : 'bg-gray-200 text-gray-500'
                                        }`}
                                    >
                                        {num}
                                    </div>
                                    <span className="mt-1 text-xs text-gray-500">{label}</span>
                                </div>
                                {num < 3 && (
                                    <div
                                        className={`h-0.5 flex-1 mx-1 transition ${
                                            step > num ? 'bg-blue-600' : 'bg-gray-200'
                                        }`}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>

                {error && (
                    <div
                        className="mt-4 rounded-lg px-4 py-3 text-sm font-medium"
                        style={{ backgroundColor: '#FFF0F3', color: '#E8446A' }}
                    >
                        {error}
                    </div>
                )}

                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (step < 3) {
                            setStep(step + 1);
                        } else {
                            handleCandidateRegister(e);
                        }
                    }}
                    className="mt-6 space-y-4"
                >
                    {/* Step 1: Identity */}
                    {step === 1 && (
                        <>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Prénom
                                    </label>
                                    <input
                                        type="text"
                                        name="firstName"
                                        required
                                        value={candidateData.firstName}
                                        onChange={handleCandidateChange}
                                        placeholder="Jean"
                                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Nom
                                    </label>
                                    <input
                                        type="text"
                                        name="lastName"
                                        required
                                        value={candidateData.lastName}
                                        onChange={handleCandidateChange}
                                        placeholder="Dupont"
                                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Email
                                </label>
                                <input
                                    type="email"
                                    name="email"
                                    required
                                    value={candidateData.email}
                                    onChange={handleCandidateChange}
                                    placeholder="jean.dupont@ecole.fr"
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Date de naissance
                                </label>
                                <input
                                    type="date"
                                    name="dateOfBirth"
                                    required
                                    value={candidateData.dateOfBirth}
                                    onChange={handleCandidateChange}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Téléphone
                                </label>
                                <input
                                    type="tel"
                                    name="phone"
                                    value={candidateData.phone}
                                    onChange={handleCandidateChange}
                                    placeholder="06 12 34 56 78"
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                            </div>
                        </>
                    )}

                    {/* Step 2: Formation */}
                    {step === 2 && (
                        <>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Formation / Prépa
                                </label>
                                <select
                                    name="formation"
                                    value={candidateData.formation}
                                    onChange={handleCandidateChange}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                                >
                                    <option value="">Sélectionner...</option>
                                    <option value="Programme Grande École">Programme Grande École</option>
                                    <option value="BBA">BBA</option>
                                    <option value="Master Spécialisé">Master Spécialisé</option>
                                    <option value="Prépa intégrée">Prépa intégrée</option>
                                    <option value="Autre">Autre</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Établissement
                                </label>
                                <input
                                    type="text"
                                    name="etablissement"
                                    value={candidateData.etablissement}
                                    onChange={handleCandidateChange}
                                    placeholder="Audencia Business School"
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Année d&apos;intégration
                                </label>
                                <input
                                    type="text"
                                    name="anneeIntegration"
                                    value={candidateData.anneeIntegration}
                                    onChange={handleCandidateChange}
                                    placeholder="2025"
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                            </div>
                        </>
                    )}

                    {/* Step 3: Documents */}
                    {step === 3 && (
                        <>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    CV (PDF)
                                </label>
                                <div
                                    onClick={() => cvInputRef.current?.click()}
                                    className="w-full rounded-lg border-2 border-dashed border-gray-300 px-4 py-6 text-center cursor-pointer hover:border-blue-400 transition"
                                >
                                    <input
                                        ref={cvInputRef}
                                        type="file"
                                        accept=".pdf"
                                        className="hidden"
                                        onChange={(e) => {
                                            if (e.target.files?.[0]) setCvFile(e.target.files[0]);
                                        }}
                                    />
                                    {cvFile ? (
                                        <span className="text-sm text-blue-600 font-medium">{cvFile.name}</span>
                                    ) : (
                                        <span className="text-sm text-gray-400">
                                            Cliquer pour sélectionner un fichier PDF
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-700">
                                Votre compte sera créé et vous pourrez accéder à votre espace candidat immédiatement.
                                Votre date de naissance servira de mot de passe pour vous reconnecter.
                            </div>
                        </>
                    )}

                    {/* Navigation buttons */}
                    <div className="flex items-center gap-3 pt-2">
                        {step > 1 && (
                            <button
                                type="button"
                                onClick={() => setStep(step - 1)}
                                className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
                            >
                                Précédent
                            </button>
                        )}
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition disabled:opacity-50"
                        >
                            {step < 3
                                ? 'Suivant'
                                : loading
                                ? 'Inscription...'
                                : "S'inscrire"}
                        </button>
                    </div>
                </form>

                <div className="mt-4 text-center space-y-2">
                    <p className="text-sm text-gray-500">
                        Déjà inscrit ?{' '}
                        <button
                            onClick={() => { resetForms(); setView('candidate-login'); }}
                            className="font-medium text-blue-600 hover:underline"
                        >
                            Se connecter
                        </button>
                    </p>
                    <button
                        onClick={() => setView('candidate-choice')}
                        className="text-sm text-gray-500 hover:text-gray-700 transition"
                    >
                        ← Retour
                    </button>
                </div>
            </div>
        </div>
    );
}
