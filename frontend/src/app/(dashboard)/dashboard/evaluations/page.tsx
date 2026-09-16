"use client";

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { hasAnyScore, toTwenty } from '@/lib/evaluation-criteria';
import {
    computeExaminerStats,
    emptyExaminerStats,
    MIN_SCORES_FOR_CALIBRATION,
    tendencyLabel,
    type ExaminerEvaluationInput,
    type ExaminerStats,
} from '@/lib/examiner-stats';
import { slotLinkHost } from '@/lib/slot-links';
import { Loader2, X, Pencil, Trash2, UserPlus, BarChart3, KeyRound, MailCheck, AlertTriangle, Lock } from 'lucide-react';

interface MemberData {
    id: string;
    firstName?: string;
    lastName?: string;
    email: string;
    password?: string;
    pole?: string;
    isAdmin: boolean;
    isSuperAdmin?: boolean;
}

interface EvaluationData {
    id: string;
    scores: Record<string, number>;
    comment?: string;
    createdAt: string;
    candidate: { id: string; firstName: string; lastName: string };
    epreuve: { id?: string; name: string; tour: number; type: string; isGroupEpreuve?: boolean; maxTotal?: number };
    member?: { id: string; firstName?: string; lastName?: string; email: string };
    /**
     * Tous les examinateurs au nom desquels la note compte : l'auteur, plus
     * les co-examinateurs inscrits au créneau d'une note partagée (binôme /
     * collective) — même ceux qui ne se sont jamais connectés.
     */
    examiners?: { id: string; firstName?: string; lastName?: string; email: string }[];
    /** Note partagée (binôme / collective) plutôt qu'avis individuel. */
    isGroup?: boolean;
    /** Ancienne note collective d'un business game (cf. isCollectiveNote). */
    isLegacyCollective?: boolean;
    closedAt?: string | null;
}

const POLES = ["Système d'information", 'Marketing', 'Développement commercial', 'Audit Qualité', 'Ressource Humaine', 'Trésorerie', 'Bureau - VP', 'Bureau - Président', 'Bureau - Secrétaire générale'];

/**
 * Calcule le total des scores (somme de tous les critères)
 */
function getScoreTotal(scores: Record<string, number | string>): number {
    if (!scores || typeof scores !== 'object') return 0;
    const values = Object.values(scores).map(Number).filter(v => !isNaN(v));
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0);
}

/**
 * Convertit le total brut d'une évaluation en note /20, en se basant sur le
 * barème réel de son épreuve (`epreuve.maxTotal`, somme des critères — ex.
 * 3 critères /20 = 60 points max). Sans ça, comparer/moyenner des totaux
 * bruts entre épreuves à barèmes différents n'a pas de sens (60 vs 20 vs 5).
 */
function getScoreOn20(ev: EvaluationData): number {
    return toTwenty(getScoreTotal(ev.scores), ev.epreuve?.maxTotal || 20);
}

/**
 * Noms de tous les examinateurs crédités d'une note : l'auteur d'abord, puis
 * les co-examinateurs inscrits au même créneau (note partagée en binôme ou
 * note collective). Repli sur le seul auteur pour les notes antérieures au
 * suivi des co-examinateurs.
 */
function examinerNames(ev: EvaluationData): string[] {
    const list = ev.examiners?.length
        ? ev.examiners
        : ev.member
            ? [ev.member]
            : [];
    return list.map(m => `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.email);
}

/**
 * Ancienne « note collective » d'une épreuve de groupe (business game) : une
 * ligne par candidat du groupe, saisie avant le 15/09/2026. Elle décrit le
 * travail DU GROUPE, pas une personne — elle ne compte donc ni comme candidat
 * évalué ni dans une moyenne. Repli sur le type d'épreuve pour les réponses
 * d'API antérieures au drapeau.
 *
 * ⚠ Ne concerne PAS la note partagée d'un binôme sur un entretien : celle-là
 * note bien un candidat et compte pour ses deux examinateurs.
 */
function isCollectiveNote(ev: EvaluationData): boolean {
    if (typeof ev.isLegacyCollective === 'boolean') return ev.isLegacyCollective;
    const groupEpreuve = ev.epreuve?.isGroupEpreuve ?? ev.epreuve?.type === 'groupe';
    return ev.isGroup === true && groupEpreuve;
}

/** Une évaluation, mise à la forme attendue par le calcul du barème. */
function toStatsInput(ev: EvaluationData): ExaminerEvaluationInput {
    const examiners = ev.examiners?.length ? ev.examiners : ev.member ? [ev.member] : [];
    return {
        id: ev.id,
        examinerIds: examiners.map(m => m.id),
        // Regroupement par épreuve : son id, à défaut son nom + son tour.
        epreuveKey: ev.epreuve?.id || `${ev.epreuve?.name || ''}::${ev.epreuve?.tour ?? ''}`,
        scoreOn20: hasAnyScore(ev.scores) ? getScoreOn20(ev) : null,
        isCollective: isCollectiveNote(ev),
    };
}

/**
 * Le « barème » d'un examinateur : de combien ses notes s'écartent de celles
 * des autres sur les mêmes épreuves, et par quel coefficient les multiplier
 * pour les y ramener. Indicatif — rien n'est appliqué automatiquement.
 */
function BaremeCell({ stats }: { stats: ExaminerStats }) {
    // Aucun point de comparaison : personne d'autre n'a noté ses épreuves.
    if (stats.coefficient === null || stats.average === null || stats.tendency === null) {
        return (
            <span
                className="text-gray-300"
                title="Aucun autre examinateur n'a noté les mêmes épreuves : rien à quoi comparer son barème."
            >
                —
            </span>
        );
    }
    const deviation = stats.deviation ?? 0;
    const unit = Math.abs(deviation) >= 2 ? 'pts' : 'pt';
    // En dessous du minimum de notes, le coefficient reste affiché — mais en
    // gris et sans qualificatif : une seule grille suffit à le faire s'envoler.
    const tone = !stats.reliable
        ? 'text-gray-400 bg-gray-50 border-gray-200'
        : stats.tendency === 'severe'
            ? 'text-amber-700 bg-amber-50 border-amber-200'
            : stats.tendency === 'genereux'
                ? 'text-indigo-700 bg-indigo-50 border-indigo-200'
                : 'text-gray-600 bg-gray-50 border-gray-200';
    return (
        <div
            className="flex flex-col items-center gap-0.5"
            title={
                `Moyenne ${stats.average}/20 sur ${stats.scored} note${stats.scored > 1 ? 's' : ''} ` +
                `(de ${stats.min} à ${stats.max}). Les autres examinateurs mettent ${stats.reference}/20 ` +
                `sur les mêmes épreuves. Multiplier ses notes par ${stats.coefficient.toFixed(2)} les ramènerait à ce barème.` +
                (stats.reliable
                    ? ''
                    : ` À prendre avec des pincettes : ${MIN_SCORES_FOR_CALIBRATION} notes sont nécessaires pour que ce soit parlant.`)
            }
        >
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}>
                ×{stats.coefficient.toFixed(2)}
            </span>
            <span className="text-[10px] text-gray-400">
                {stats.reliable
                    ? `${tendencyLabel(stats.tendency)} · ${deviation > 0 ? '+' : ''}${deviation} ${unit}`
                    : `sur ${stats.scored} note${stats.scored > 1 ? 's' : ''}`}
            </span>
        </div>
    );
}

/**
 * Calcule la moyenne par critère (total / nombre de critères)
 */
function getScoreAverage(scores: Record<string, number>): number {
    if (!scores || typeof scores !== 'object') return 0;
    const values = Object.values(scores).filter(v => typeof v === 'number' && !isNaN(v));
    if (values.length === 0) return 0;
    return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10;
}

function getInitials(firstName?: string, lastName?: string): string {
    const f = firstName ? firstName[0].toUpperCase() : '';
    const l = lastName ? lastName[0].toUpperCase() : '';
    return f + l || '?';
}

/**
 * « jeu. 15 sept. · 16:00–16:55 · salle 235 » — le créneau tel qu'un
 * examinateur le reconnaît. `date` arrive en timestamptz : on n'en garde que
 * le jour, les heures sont des textes locaux.
 */
function slotLabel(s: { date?: string | null; startTime?: string | null; endTime?: string | null; room?: string | null }): string {
    const parts: string[] = [];
    const day = String(s.date || '').split('T')[0];
    if (day) {
        const d = new Date(`${day}T12:00:00`);
        if (!isNaN(d.getTime())) {
            parts.push(d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }));
        }
    }
    if (s.startTime) {
        parts.push(`${s.startTime.slice(0, 5)}${s.endTime ? `–${s.endTime.slice(0, 5)}` : ''}`);
    }
    if (s.room) parts.push(`salle ${s.room}`);
    return parts.join(' · ');
}

// ─── ADMIN VIEW ────────────────────────────────────────────────────────────────

function AdminView() {
    const [members, setMembers] = useState<MemberData[]>([]);
    const [evaluations, setEvaluations] = useState<EvaluationData[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [showCreateForm, setShowCreateForm] = useState(false);

    // Edit modal state
    const [editingMember, setEditingMember] = useState<MemberData | null>(null);
    const [editForm, setEditForm] = useState({ firstName: '', lastName: '', email: '', password: '', pole: POLES[0], isAdmin: false });
    const [editSaving, setEditSaving] = useState(false);

    const [form, setForm] = useState({
        firstName: '',
        lastName: '',
        email: '',
        password: '',
        pole: POLES[0],
    });

    const fetchAll = async () => {
        setLoading(true);
        try {
            const [membersRes, evalsRes] = await Promise.all([
                api.get('/members'),
                api.get('/evaluations'),
            ]);
            setMembers(membersRes.data);
            setEvaluations(evalsRes.data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAll();
    }, []);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreating(true);
        try {
            await api.post('/members', form);
            setForm({ firstName: '', lastName: '', email: '', password: '', pole: POLES[0] });
            setShowCreateForm(false);
            fetchAll();
        } catch (err: any) {
            alert(err.response?.data?.error || 'Erreur lors de la création');
        } finally {
            setCreating(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Supprimer cet évaluateur ? Cette action est irréversible.')) return;
        try {
            await api.delete(`/members/${id}`);
            fetchAll();
        } catch (e: any) {
            alert(e.response?.data?.error || 'Erreur lors de la suppression');
        }
    };

    const openEditModal = (m: MemberData) => {
        setEditingMember(m);
        setEditForm({
            firstName: m.firstName || '',
            lastName: m.lastName || '',
            email: m.email,
            password: '',
            pole: m.pole || POLES[0],
            isAdmin: m.isAdmin,
        });
    };

    const handleEditSave = async () => {
        if (!editingMember) return;
        setEditSaving(true);
        try {
            const payload: any = {
                firstName: editForm.firstName,
                lastName: editForm.lastName,
                email: editForm.email,
                pole: editForm.pole,
                // Le super-admin reste toujours admin ; les admins classiques
                // peuvent être rétrogradés.
                isAdmin: editingMember.isSuperAdmin ? true : editForm.isAdmin,
            };
            if (editForm.password) {
                payload.password = editForm.password;
            }
            await api.put(`/members/${editingMember.id}`, payload);
            setEditingMember(null);
            fetchAll();
        } catch (err: any) {
            alert(err.response?.data?.error || 'Erreur lors de la modification');
        } finally {
            setEditSaving(false);
        }
    };

    // ── Liens « choisir son mot de passe » ──
    const [sendingLink, setSendingLink] = useState<string | null>(null);
    const [bulkSending, setBulkSending] = useState(false);

    const sendResetLink = async (m: MemberData) => {
        const name = `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.email;
        if (!confirm(`Envoyer à ${name} un lien pour choisir son mot de passe ?\n\nSon mot de passe actuel reste valable tant qu'il n'a pas utilisé le lien.`)) return;
        setSendingLink(m.id);
        try {
            await api.post('/members/reset-links', { memberId: m.id, forceChange: true });
            alert(`Lien envoyé à ${m.email}.`);
        } catch (err: any) {
            alert(err.response?.data?.error || "Erreur lors de l'envoi du lien");
        } finally {
            setSendingLink(null);
        }
    };

    const sendAllResetLinks = async () => {
        const count = members.filter(m => !m.isSuperAdmin).length;
        if (!confirm(
            `Envoyer un lien de définition de mot de passe aux ${count} membres ?\n\n` +
            `Chacun recevra un email et devra choisir son propre mot de passe à sa prochaine connexion. ` +
            `Le compte super-admin est exclu.`
        )) return;
        setBulkSending(true);
        try {
            const res = await api.post('/members/reset-links', { all: true, forceChange: true });
            const failed: string[] = res.data?.failed || [];
            alert(
                `${res.data?.sent || 0} email(s) envoyé(s) sur ${res.data?.total || 0}.` +
                (failed.length ? `\n\nÉchecs : ${failed.join(', ')}` : '')
            );
        } catch (err: any) {
            alert(err.response?.data?.error || "Erreur lors de l'envoi des liens");
        } finally {
            setBulkSending(false);
        }
    };

    // ── Stats ──
    const evaluateurCount = members.filter(m => !m.isAdmin).length;

    // Évaluations qui notent un CANDIDAT. Les anciennes notes collectives des
    // business games (une ligne par candidat du groupe, plus créées depuis le
    // 15/09/2026) en sont exclues partout : elles notaient le groupe, et
    // faisaient afficher « 4 évaluations » à qui n'avait vu que 2 candidats.
    const candidateEvaluations = evaluations.filter(ev => !isCollectiveNote(ev));
    const collectiveCount = evaluations.length - candidateEvaluations.length;

    // Note moyenne GLOBALE = vraie moyenne des notes /20 (chaque évaluation
    // est d'abord ramenée à /20 selon le barème de son épreuve, sinon
    // moyenner des totaux bruts d'épreuves à barèmes différents n'a pas de sens).
    // Un 0/20 saisi est une note et compte ; une évaluation SANS aucune note
    // (grille créée à vide) est écartée.
    const allTotals = candidateEvaluations.filter(ev => hasAnyScore(ev.scores)).map(ev => getScoreOn20(ev));
    const avgScore = allTotals.length > 0
        ? Math.round((allTotals.reduce((a, b) => a + b, 0) / allTotals.length) * 10) / 10
        : 0;
    const evalCount = candidateEvaluations.length;

    // Par membre : candidats évalués, moyenne /20 et barème (écart aux autres
    // examinateurs sur les mêmes épreuves). Une note partagée compte pour
    // CHAQUE examinateur inscrit au créneau, pas seulement pour celui qui l'a
    // saisie — l'autre a fait passer l'entretien même sans se connecter.
    const examinerStats = computeExaminerStats(evaluations.map(toStatsInput));

    if (loading) {
        return (
            <div className="flex justify-center p-12">
                <Loader2 className="animate-spin text-blue-500" size={32} />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <h1 className="text-2xl font-semibold text-gray-900">Évaluateurs</h1>
                    <p className="text-gray-500 mt-1">Comptes membres JE et notations</p>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 shrink-0">
                    <button
                        onClick={sendAllResetLinks}
                        disabled={bulkSending}
                        className="flex items-center justify-center gap-2 border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium px-4 py-2 min-h-[44px] rounded-lg text-sm transition-colors disabled:opacity-50"
                        title="Chaque membre reçoit un email pour choisir lui-même son mot de passe"
                    >
                        <MailCheck size={16} className="shrink-0" />
                        {bulkSending ? 'Envoi…' : 'Envoyer les liens mot de passe'}
                    </button>
                    <button
                        onClick={() => setShowCreateForm(!showCreateForm)}
                        className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 min-h-[44px] rounded-lg text-sm transition-colors"
                    >
                        <UserPlus size={16} className="shrink-0" />
                        Nouvel évaluateur
                    </button>
                </div>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white border border-blue-200 rounded-xl p-5">
                    <p className="text-sm text-blue-600 font-medium">Évaluateurs</p>
                    <p className="text-3xl font-bold text-blue-700 mt-1">{evaluateurCount}</p>
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-5">
                    <p className="text-sm text-gray-500 font-medium">Note moyenne globale</p>
                    <p className="text-3xl font-bold text-gray-700 mt-1">{avgScore ? `${avgScore}/20` : '-'}</p>
                </div>
                <div className="bg-white border border-green-200 rounded-xl p-5">
                    <p className="text-sm text-green-600 font-medium">Évaluations saisies</p>
                    <p className="text-3xl font-bold text-green-700 mt-1">{evalCount}</p>
                    {collectiveCount > 0 && (
                        <p
                            className="text-[11px] text-gray-400 mt-1"
                            title="Anciennes notes collectives de business game, une ligne par candidat du groupe. Elles ne notent personne et n'entrent dans aucune moyenne."
                        >
                            + {collectiveCount} ligne{collectiveCount > 1 ? 's' : ''} collective{collectiveCount > 1 ? 's' : ''} archivée{collectiveCount > 1 ? 's' : ''}, hors décompte
                        </p>
                    )}
                </div>
            </div>

            {/* Create evaluator form (collapsible) */}
            {showCreateForm && (
                <div className="bg-white border rounded-xl p-4 sm:p-6 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-gray-900">Créer un compte évaluateur</h2>
                        <button onClick={() => setShowCreateForm(false)} className="text-gray-400 hover:text-gray-600">
                            <X size={20} />
                        </button>
                    </div>
                    <form onSubmit={handleCreate} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-700">Prénom</label>
                                <input
                                    type="text"
                                    required
                                    value={form.firstName}
                                    onChange={e => setForm({ ...form, firstName: e.target.value })}
                                    placeholder="Jean"
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-700">Nom</label>
                                <input
                                    type="text"
                                    required
                                    value={form.lastName}
                                    onChange={e => setForm({ ...form, lastName: e.target.value })}
                                    placeholder="Dupont"
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-700">Email</label>
                                <input
                                    type="email"
                                    required
                                    value={form.email}
                                    onChange={e => setForm({ ...form, email: e.target.value })}
                                    placeholder="jean.dupont@ecole.fr"
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-700">Mot de passe</label>
                                <input
                                    type="text"
                                    required
                                    value={form.password}
                                    onChange={e => setForm({ ...form, password: e.target.value })}
                                    placeholder="MotDePasse123"
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium text-gray-700">Pôle</label>
                            <select
                                value={form.pole}
                                onChange={e => setForm({ ...form, pole: e.target.value })}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                            >
                                {POLES.map(p => (
                                    <option key={p} value={p}>{p}</option>
                                ))}
                            </select>
                        </div>
                        <button
                            type="submit"
                            disabled={creating}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2 rounded-lg text-sm disabled:opacity-50 transition-colors"
                        >
                            {creating ? 'Création...' : 'Créer le compte'}
                        </button>
                    </form>
                </div>
            )}

            {/* Table: All evaluators */}
            <div className="bg-white border rounded-xl overflow-hidden">
                <div className="px-4 sm:px-6 py-4 border-b">
                    <h2 className="text-lg font-semibold text-gray-900">Tous les évaluateurs</h2>
                    <p className="text-xs text-gray-400 mt-1">
                        « Évals » = candidats notés (une note en binôme compte pour ses deux examinateurs ;
                        une note de groupe ne compte pour personne). « Barème » = son écart aux autres
                        examinateurs sur les mêmes épreuves, et le coefficient qui l&apos;y ramènerait.
                    </p>
                </div>
                <div className="scroll-x">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                            <tr>
                                <th className="px-3 sm:px-6 py-3">Membre</th>
                                <th className="px-3 sm:px-6 py-3">Pôle</th>
                                <th className="px-3 sm:px-6 py-3">Email</th>
                                <th className="px-3 sm:px-6 py-3 text-center">Évals</th>
                                <th className="px-3 sm:px-6 py-3 text-center">Note moyenne</th>
                                <th className="px-3 sm:px-6 py-3 text-center">Barème</th>
                                <th className="px-3 sm:px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {(() => {
                                // Regrouper les membres par pôle (pôles connus dans
                                // l'ordre, "Sans pôle" en dernier).
                                const order = [...POLES, '__none__'];
                                const groups = new Map<string, MemberData[]>();
                                members.forEach((m) => {
                                    const key = m.pole && POLES.includes(m.pole) ? m.pole : '__none__';
                                    if (!groups.has(key)) groups.set(key, []);
                                    groups.get(key)!.push(m);
                                });
                                const orderedKeys = order.filter((k) => groups.has(k));
                                return orderedKeys.flatMap((poleKey) => {
                                    const groupMembers = groups.get(poleKey)!;
                                    const header = (
                                        <tr key={`hdr-${poleKey}`} className="bg-gray-50/80">
                                            <td colSpan={7} className="px-4 sm:px-6 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                {poleKey === '__none__' ? 'Sans pôle' : poleKey}
                                                <span className="ml-2 text-gray-400 font-normal normal-case">
                                                    {groupMembers.length} membre{groupMembers.length > 1 ? 's' : ''}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                    const rows = groupMembers.map((m) => {
                                const stats = examinerStats[m.id] || emptyExaminerStats();
                                const mEvals = stats.evaluations;
                                const mAvg = stats.average;
                                const displayName = `${m.firstName || ''} ${m.lastName || ''}`.trim();
                                return (
                                    <tr key={m.id} className="hover:bg-gray-50">
                                        <td className="px-3 sm:px-6 py-3">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                                    {getInitials(m.firstName, m.lastName)}
                                                </div>
                                                <div>
                                                    <span className="font-medium text-gray-900 block">
                                                        {displayName || <span className="text-gray-400 italic">Sans nom</span>}
                                                    </span>
                                                    {m.isSuperAdmin ? (
                                                        <span className="text-[10px] font-semibold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">Super-admin</span>
                                                    ) : m.isAdmin ? (
                                                        <span className="text-[10px] font-semibold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">Admin</span>
                                                    ) : null}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-3 sm:px-6 py-3">
                                            {m.pole ? (
                                                <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-1 rounded-full">{m.pole}</span>
                                            ) : (
                                                <span className="text-gray-400">-</span>
                                            )}
                                        </td>
                                        <td className="px-3 sm:px-6 py-3 text-gray-600 text-xs">{m.email}</td>
                                        <td className="px-3 sm:px-6 py-3 text-center">
                                            {mEvals > 0 ? (
                                                <span className="inline-flex items-center gap-1 text-green-700 font-semibold">
                                                    <BarChart3 size={12} />
                                                    {mEvals}
                                                </span>
                                            ) : (
                                                <span className="text-gray-400">0</span>
                                            )}
                                            {stats.collectiveNotes > 0 && (
                                                <span
                                                    className="block text-[10px] text-indigo-500"
                                                    title="Ancienne note collective de business game : elle note le travail du groupe, pas un candidat. Elle n'entre ni dans ce décompte ni dans les moyennes."
                                                >
                                                    +{stats.collectiveNotes} note{stats.collectiveNotes > 1 ? 's' : ''} de groupe
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 sm:px-6 py-3 text-center">
                                            {mAvg !== null ? (
                                                <span className="font-bold text-blue-600">{mAvg}/20</span>
                                            ) : (
                                                <span className="text-gray-400">-</span>
                                            )}
                                        </td>
                                        <td className="px-3 sm:px-6 py-3 text-center">
                                            <BaremeCell stats={stats} />
                                        </td>
                                        <td className="px-3 sm:px-6 py-3 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                <button
                                                    onClick={() => openEditModal(m)}
                                                    className="inline-flex h-9 w-9 sm:h-7 sm:w-7 items-center justify-center text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                    title="Modifier"
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                                <button
                                                    onClick={() => sendResetLink(m)}
                                                    disabled={sendingLink === m.id}
                                                    className="inline-flex h-9 w-9 sm:h-7 sm:w-7 items-center justify-center text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-50"
                                                    title="Envoyer un lien pour choisir son mot de passe"
                                                >
                                                    <KeyRound size={14} />
                                                </button>
                                                {!m.isSuperAdmin && (
                                                <button
                                                    onClick={() => handleDelete(m.id)}
                                                    className="inline-flex h-9 w-9 sm:h-7 sm:w-7 items-center justify-center text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                                    title="Supprimer"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                                    });
                                    return [header, ...rows];
                                });
                            })()}
                        </tbody>
                    </table>
                    {members.length === 0 && (
                        <p className="text-center text-gray-400 py-8">Aucun évaluateur pour le moment.</p>
                    )}
                </div>
            </div>

            {/* Table: Evaluation recap with collective scores */}
            <div className="bg-white border rounded-xl overflow-hidden">
                <div className="px-4 sm:px-6 py-4 border-b">
                    <h2 className="text-lg font-semibold text-gray-900">Récap des évaluations données</h2>
                    <p className="text-xs text-gray-400 mt-1">
                        Une ligne par note saisie. La moyenne est celle des examinateurs du candidat sur l&apos;épreuve —
                        les anciennes notes collectives de groupe en sont exclues.
                    </p>
                </div>
                <div className="scroll-x">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                            <tr>
                                <th className="px-3 sm:px-6 py-3">Évaluateur</th>
                                <th className="px-3 sm:px-6 py-3">Candidat</th>
                                <th className="px-3 sm:px-6 py-3">Épreuve</th>
                                <th className="px-3 sm:px-6 py-3 text-center">Tour</th>
                                <th className="px-3 sm:px-6 py-3 text-center">Note individuelle</th>
                                <th className="px-3 sm:px-6 py-3 text-center">Moyenne du candidat</th>
                                <th className="px-3 sm:px-6 py-3">Commentaire</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {evaluations.map(ev => {
                                // Moyenne du candidat = moyenne des notes /20 des examinateurs pour
                                // même candidat + même épreuve (par id ; à défaut nom + tour), hors
                                // lignes sans aucune note et hors anciennes notes collectives.
                                const sameEpreuve = (e: EvaluationData) =>
                                    ev.epreuve?.id && e.epreuve?.id
                                        ? e.epreuve.id === ev.epreuve.id
                                        : e.epreuve?.name === ev.epreuve?.name && e.epreuve?.tour === ev.epreuve?.tour;
                                const sameGroup = evaluations.filter(
                                    e => e.candidate?.id === ev.candidate?.id && sameEpreuve(e)
                                        && hasAnyScore(e.scores) && !isCollectiveNote(e)
                                );
                                const groupTotals = sameGroup.map(e => getScoreOn20(e));
                                const collectiveScore = groupTotals.length > 0
                                    ? Math.round((groupTotals.reduce((a, b) => a + b, 0) / groupTotals.length) * 10) / 10
                                    : 0;
                                const groupCount = sameGroup.length;

                                return (
                                    <tr key={ev.id} className="hover:bg-gray-50">
                                        <td className="px-3 sm:px-6 py-3 font-medium text-gray-900">
                                            {examinerNames(ev).length > 0 ? (
                                                examinerNames(ev).map((name, i) => (
                                                    <span key={i} className="block">
                                                        {name}
                                                        {i > 0 && (
                                                            <span className="ml-1 text-[10px] font-normal text-indigo-500">co-examinateur</span>
                                                        )}
                                                    </span>
                                                ))
                                            ) : '-'}
                                        </td>
                                        <td className="px-3 sm:px-6 py-3 text-gray-700">
                                            {ev.candidate?.firstName || ''} {ev.candidate?.lastName || ''}
                                        </td>
                                        <td className="px-3 sm:px-6 py-3 text-gray-600">{ev.epreuve?.name || '-'}</td>
                                        <td className="px-3 sm:px-6 py-3 text-center">
                                            <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs font-medium">
                                                T{ev.epreuve?.tour || '?'}
                                            </span>
                                        </td>
                                        <td className="px-3 sm:px-6 py-3 text-center font-bold text-blue-600">
                                            {hasAnyScore(ev.scores) ? `${getScoreOn20(ev)}/20` : '—'}
                                            {isCollectiveNote(ev) ? (
                                                <span
                                                    className="block text-[10px] font-normal text-amber-600"
                                                    title="Ancienne note collective de business game : elle note le groupe. Elle ne compte ni pour un candidat ni pour un examinateur."
                                                >
                                                    note de groupe · ne compte pas
                                                </span>
                                            ) : ev.isGroup ? (
                                                <span className="block text-[10px] font-normal text-indigo-500">note partagée</span>
                                            ) : null}
                                        </td>
                                        <td className="px-3 sm:px-6 py-3 text-center">
                                            <div className="flex items-center justify-center gap-1.5">
                                                <span className="font-bold text-green-700">{collectiveScore}/20</span>
                                                <span className="text-xs text-gray-400">({groupCount} eval{groupCount > 1 ? 's' : ''})</span>
                                            </div>
                                        </td>
                                        <td className="px-3 sm:px-6 py-3 text-gray-500 italic max-w-xs truncate">{ev.comment || '-'}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {evaluations.length === 0 && (
                        <p className="text-center text-gray-400 py-8">Aucune évaluation enregistrée.</p>
                    )}
                </div>
            </div>

            {/* ─── Edit Member Modal ─── */}
            {editingMember && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                    <div
                        className="bg-white rounded-xl shadow-xl max-w-lg w-full p-4 sm:p-6 max-h-modal overflow-y-auto"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-5">
                            <h1 className="text-lg font-semibold text-gray-900">Modifier l&apos;évaluateur</h1>
                            <button onClick={() => setEditingMember(null)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-gray-700">Prénom</label>
                                    <input
                                        type="text"
                                        value={editForm.firstName}
                                        onChange={e => setEditForm({ ...editForm, firstName: e.target.value })}
                                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-gray-700">Nom</label>
                                    <input
                                        type="text"
                                        value={editForm.lastName}
                                        onChange={e => setEditForm({ ...editForm, lastName: e.target.value })}
                                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-700">Email</label>
                                <input
                                    type="email"
                                    value={editForm.email}
                                    onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-700">Pôle</label>
                                <select
                                    value={editForm.pole}
                                    onChange={e => setEditForm({ ...editForm, pole: e.target.value })}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                >
                                    {POLES.map(p => (
                                        <option key={p} value={p}>{p}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-700">
                                    Nouveau mot de passe <span className="text-gray-400 font-normal">(laisser vide pour conserver)</span>
                                </label>
                                <input
                                    type="text"
                                    value={editForm.password}
                                    onChange={e => setEditForm({ ...editForm, password: e.target.value })}
                                    placeholder="Nouveau mot de passe"
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="editIsAdmin"
                                    checked={editForm.isAdmin}
                                    onChange={e => setEditForm({ ...editForm, isAdmin: e.target.checked })}
                                    disabled={editingMember?.isSuperAdmin}
                                    className="rounded border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                />
                                <label htmlFor="editIsAdmin" className="text-sm text-gray-700">
                                    Administrateur
                                    {editingMember?.isSuperAdmin && (
                                        <span className="ml-2 text-xs text-gray-500 italic">
                                            (super-admin — verrouillé)
                                        </span>
                                    )}
                                </label>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
                            <button
                                onClick={() => setEditingMember(null)}
                                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                            >
                                Annuler
                            </button>
                            <button
                                onClick={handleEditSave}
                                disabled={editSaving}
                                className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2 rounded-lg text-sm disabled:opacity-50 transition-colors flex items-center gap-2"
                            >
                                {editSaving && <Loader2 className="animate-spin" size={14} />}
                                Enregistrer
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── MEMBER VIEW ───────────────────────────────────────────────────────────────

function MemberView() {
    const [evaluations, setEvaluations] = useState<EvaluationData[]>([]);
    const [nextCandidates, setNextCandidates] = useState<any[]>([]);
    // Candidats de mes créneaux dont la notation est close (ma note, celle du
    // binôme, ou celle du pair qui les a observés en business game). Ils ne
    // sont plus proposés, mais rester visibles évite de croire à une perte.
    const [doneCandidates, setDoneCandidates] = useState<any[]>([]);
    // Business games terminés où un candidat n'a reçu aucune note.
    const [coverageAlerts, setCoverageAlerts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // La route renvoie { candidates, done, alerts } ; un ancien tableau brut
    // (réponse en cache) reste accepté.
    const applyNext = (data: any) => {
        if (Array.isArray(data)) {
            setNextCandidates(data);
            setDoneCandidates([]);
            setCoverageAlerts([]);
            return;
        }
        setNextCandidates(Array.isArray(data?.candidates) ? data.candidates : []);
        setDoneCandidates(Array.isArray(data?.done) ? data.done : []);
        setCoverageAlerts(Array.isArray(data?.alerts) ? data.alerts : []);
    };

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Utiliser /evaluations directement — l'API scope déjà par member_id pour les non-admin
                const evalsRes = await api.get('/evaluations');
                setEvaluations(Array.isArray(evalsRes.data) ? evalsRes.data : []);

                // Try to fetch next candidates to evaluate
                try {
                    const nextRes = await api.get('/evaluations/next-candidates');
                    applyNext(nextRes.data);
                } catch {
                    // Endpoint may not exist yet
                }
            } catch (e) {
                console.error('Erreur chargement evaluations:', e);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    // Coche/décoche "j'examine ce candidat" (épreuves de groupe) puis
    // rafraîchit la liste pour voir qui observe qui.
    const toggleTarget = async (c: any, on: boolean) => {
        try {
            await api.post('/evaluations/targets', { slotId: c.slotId, candidateId: c.id, on });
            const nextRes = await api.get('/evaluations/next-candidates');
            applyNext(nextRes.data);
        } catch (e) {
            console.error('Erreur cochage examinateur:', e);
        }
    };

    // Stats — moyenne globale des notes /20 (chaque évaluation ramenée à /20
    // selon le barème de son épreuve avant d'être moyennée). Les anciennes
    // notes collectives de business game ne notent pas un candidat : elles
    // sont comptées à part, jamais dans le total ni dans la moyenne.
    const myCandidateEvals = evaluations.filter(ev => !isCollectiveNote(ev));
    // Une seule note de groupe par épreuve, quel que soit le nombre de
    // candidats du groupe — même décompte que le tableau admin.
    const myCollectiveCount = new Set(
        evaluations
            .filter(isCollectiveNote)
            .map(ev => ev.epreuve?.id || `${ev.epreuve?.name || ''}::${ev.epreuve?.tour ?? ''}`)
    ).size;
    const totalEvals = myCandidateEvals.length;
    const allTotals = myCandidateEvals.filter(ev => hasAnyScore(ev.scores)).map(ev => getScoreOn20(ev));
    const avgScore = allTotals.length > 0
        ? Math.round((allTotals.reduce((a, b) => a + b, 0) / allTotals.length) * 10) / 10
        : 0;

    if (loading) {
        return (
            <div className="flex justify-center p-12">
                <Loader2 className="animate-spin text-blue-500" size={32} />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-semibold text-gray-900">Mes évaluations</h1>
                <p className="text-gray-500 mt-1">Récapitulatif de vos notations</p>
            </div>

            {/* Alerte de couverture : business game terminé, candidats sans note.
                Personne ne s'en aperçoit avant la délibération, sinon. */}
            {coverageAlerts.length > 0 && (
                <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 sm:p-5">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="text-amber-600 flex-shrink-0 mt-0.5" size={20} />
                        <div className="flex-1 min-w-0">
                            <p className="font-semibold text-amber-900">
                                Business game : {coverageAlerts.length > 1 ? 'des candidats n’ont' : 'un candidat n’a'} pas été évalué
                            </p>
                            <p className="text-xs text-amber-700 mt-0.5">
                                L&apos;épreuve est terminée et il manque encore des notes. Chaque candidat doit être noté une fois, par l&apos;examinateur qui l&apos;a observé.
                            </p>
                            <div className="mt-3 space-y-3">
                                {coverageAlerts.map((a: any) => (
                                    <div key={a.slotId} className="bg-white border border-amber-200 rounded-lg p-3">
                                        <p className="text-sm font-medium text-gray-900">
                                            {a.epreuveName?.trim() || 'Business game'}
                                            {a.tour ? ` · Tour ${a.tour}` : ''}
                                            {' · '}
                                            {slotLabel(a)}
                                        </p>
                                        <p className="text-xs text-amber-700 mt-1">
                                            {a.missing.length} candidat{a.missing.length > 1 ? 's' : ''} sur {a.totalCandidates} sans note :
                                        </p>
                                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                                            {a.missing.map((m: any) => (
                                                <a
                                                    key={m.id}
                                                    href={`/dashboard/candidates/${m.id}/evaluate?epreuveId=${a.epreuveId}`}
                                                    className="inline-flex items-center gap-1 text-xs font-medium bg-amber-100 hover:bg-amber-200 text-amber-900 px-2 py-1 rounded-full transition-colors"
                                                >
                                                    {m.name} →
                                                </a>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white border border-blue-200 rounded-xl p-5">
                    <p className="text-sm text-blue-600 font-medium">Candidats évalués</p>
                    <p className="text-3xl font-bold text-blue-700 mt-1">{totalEvals}</p>
                    {myCollectiveCount > 0 && (
                        <p className="text-[11px] text-gray-400 mt-1">
                            + {myCollectiveCount} note{myCollectiveCount > 1 ? 's' : ''} de groupe, hors décompte
                        </p>
                    )}
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-5">
                    <p className="text-sm text-gray-500 font-medium">Note moyenne globale</p>
                    <p className="text-3xl font-bold text-gray-700 mt-1">{avgScore ? `${avgScore}/20` : '-'}</p>
                </div>
            </div>

            {/* History card */}
            <div className="bg-white border rounded-xl p-4 sm:p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Historique</h2>
                {evaluations.length === 0 ? (
                    <p className="text-center text-gray-400 py-8">Vous n&apos;avez encore soumis aucune évaluation.</p>
                ) : (
                    <div className="space-y-3">
                        {evaluations.map(ev => (
                            <div key={ev.id} className="flex flex-wrap items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                                {/* Avatar */}
                                <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
                                    {getInitials(ev.candidate?.firstName, ev.candidate?.lastName)}
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-[140px]">
                                    <p className="font-medium text-gray-900">
                                        {ev.candidate?.firstName || ''} {ev.candidate?.lastName || ''}
                                    </p>
                                    <p className="text-sm text-gray-500">
                                        {ev.epreuve?.name || ''} &middot; Tour {ev.epreuve?.tour || '?'}
                                    </p>
                                    {isCollectiveNote(ev) ? (
                                        <p className="text-xs text-amber-600">
                                            Ancienne note de groupe &middot; ne compte pour aucun candidat
                                        </p>
                                    ) : ev.isGroup && examinerNames(ev).length > 1 ? (
                                        <p className="text-xs text-indigo-500">
                                            Note partagée &middot; {examinerNames(ev).join(' & ')}
                                        </p>
                                    ) : null}
                                    {ev.comment && (
                                        <p className="text-sm text-gray-400 italic mt-1 truncate">{ev.comment}</p>
                                    )}
                                </div>

                                {/* Score */}
                                <div className="flex flex-col items-center flex-shrink-0 px-1 sm:px-3">
                                    <span className="text-2xl font-bold text-blue-600">{getScoreOn20(ev)}</span>
                                    <span className="text-[10px] text-gray-400">/20</span>
                                </div>

                                {/* Link */}
                                <a
                                    href={`/dashboard/candidates/${ev.candidate?.id}`}
                                    className="text-blue-600 hover:underline text-sm font-medium flex-shrink-0 w-full sm:w-auto text-right inline-flex items-center justify-end min-h-[36px]"
                                >
                                    Voir fiche
                                </a>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Next candidates card */}
            <div className="bg-white border rounded-xl p-4 sm:p-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-gray-900">Prochains candidats à évaluer</h2>
                    {nextCandidates.length > 0 && (
                        <span className="text-xs font-semibold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                            {nextCandidates.length} en attente
                        </span>
                    )}
                </div>
                {nextCandidates.length === 0 ? (
                    <p className="text-center text-gray-400 py-8">
                        {doneCandidates.length > 0
                            ? 'Tout est noté : plus aucun candidat en attente.'
                            : 'Aucun candidat en attente d’évaluation.'}
                    </p>
                ) : (
                    <div className="space-y-3">
                        {nextCandidates.map((c: any, i: number) => {
                            const slotDate = c.slotDate ? new Date(c.slotDate) : null;
                            const dateLabel = slotDate
                                ? slotDate.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
                                : null;
                            const timeLabel = c.slotStartTime
                                ? `${c.slotStartTime.slice(0, 5)}${c.slotEndTime ? `–${c.slotEndTime.slice(0, 5)}` : ''}`
                                : null;
                            return (
                                <div key={c.id + (c.epreuve?.id || '') + i} className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                        <div className="w-10 h-10 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
                                            {getInitials(c.firstName, c.lastName)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-gray-900 flex items-center gap-2 flex-wrap">
                                                {c.firstName} {c.lastName}
                                                {c.epreuve?.isGroupEpreuve && (
                                                    <span className="text-[10px] font-semibold bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full">
                                                        👥 Groupe
                                                    </span>
                                                )}
                                            </p>
                                            {c.epreuve && (
                                                <p className="text-sm text-gray-500 truncate">
                                                    {c.epreuve.name} · Tour {c.epreuve.tour}
                                                </p>
                                            )}
                                            <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5 flex-wrap">
                                                {dateLabel && <span>📅 {dateLabel}</span>}
                                                {timeLabel && <span>🕐 {timeLabel}</span>}
                                                {c.slotRoom && <span>🏫 {c.slotRoom}</span>}
                                            </div>
                                            {/* Lien du business game de CE créneau.
                                                Il ne parvient ici que par les affectations
                                                de l'examinateur connecté : les candidats et
                                                les autres groupes ne le reçoivent jamais. */}
                                            {c.slotLink && (
                                                <a
                                                    href={c.slotLink.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline mt-1"
                                                    title={c.slotLink.url}
                                                >
                                                    🔗 {c.slotLink.label || slotLinkHost(c.slotLink.url) || 'Lien du BG'}
                                                </a>
                                            )}
                                            {c.epreuve?.isGroupEpreuve && c.slotId && (
                                                <div className="flex items-center gap-2 mt-2 flex-wrap">
                                                    <label className="flex items-center gap-1.5 text-xs font-medium text-gray-700 cursor-pointer select-none">
                                                        <input
                                                            type="checkbox"
                                                            className="rounded border-gray-300"
                                                            checked={(c.targets || []).some((t: any) => t.isMe)}
                                                            onChange={(e) => toggleTarget(c, e.target.checked)}
                                                        />
                                                        J&apos;examine ce candidat
                                                    </label>
                                                    {(c.targets || []).filter((t: any) => !t.isMe).map((t: any, j: number) => (
                                                        <span key={j} className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">
                                                            👁 {`${t.firstName || ''} ${t.lastName || ''}`.trim() || 'Examinateur'}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <a
                                        href={`/dashboard/candidates/${c.id}/evaluate${c.epreuve?.id ? `?epreuveId=${c.epreuve.id}` : ''}`}
                                        className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex-shrink-0 text-center"
                                    >
                                        Évaluer
                                    </a>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Notations closes : plus de bouton « Évaluer », mais on montre
                qui a noté — sinon les candidats semblent avoir disparu. */}
            {doneCandidates.length > 0 && (
                <div className="bg-white border rounded-xl p-4 sm:p-6">
                    <div className="flex items-center justify-between mb-1">
                        <h2 className="text-lg font-semibold text-gray-900">Notations closes</h2>
                        <span className="text-xs font-semibold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                            {doneCandidates.length}
                        </span>
                    </div>
                    <p className="text-xs text-gray-500 mb-4">
                        Candidats de vos créneaux déjà notés. Une seule note par candidat et par épreuve.
                    </p>
                    <div className="space-y-2">
                        {doneCandidates.map((c: any, i: number) => (
                            <div
                                key={c.id + (c.epreuve?.id || '') + i}
                                className="flex flex-wrap items-center gap-3 p-3 bg-gray-50 rounded-lg"
                            >
                                <div className="w-9 h-9 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                    {getInitials(c.firstName, c.lastName)}
                                </div>
                                <div className="flex-1 min-w-[140px]">
                                    <p className="font-medium text-gray-800">
                                        {c.firstName} {c.lastName}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                        {c.epreuve?.name} · Tour {c.epreuve?.tour ?? '?'}
                                    </p>
                                </div>
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 flex-shrink-0">
                                    <Lock size={12} />
                                    {c.closedReason === 'mine'
                                        ? 'Évalué par vous'
                                        : c.closedReason === 'shared'
                                            ? `Note de binôme · ${c.closedBy?.name || 'binôme'}`
                                            : `Évalué par ${c.closedBy?.name || 'un examinateur'}`}
                                </span>
                                <a
                                    href={`/dashboard/candidates/${c.id}`}
                                    className="text-blue-600 hover:underline text-sm font-medium flex-shrink-0 w-full sm:w-auto text-right"
                                >
                                    Voir fiche
                                </a>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── MAIN PAGE ─────────────────────────────────────────────────────────────────

export default function EvaluationsPage() {
    const { user, role } = useAuth();
    const isRealAdmin = role === 'member' && !!user?.isAdmin;
    const isSuperAdmin = !!user?.isSuperAdmin;
    // Les admins non-super sont aussi des membres : ils peuvent basculer
    // vers leur espace membre (évaluer, voir leurs créneaux). Le super-admin
    // garde la vue admin pure.
    const [memberMode, setMemberMode] = useState(false);
    const showAdmin = isRealAdmin && !memberMode;
    const canToggle = isRealAdmin && !isSuperAdmin;

    return (
        <div className="space-y-4">
            {canToggle && (
                <div className="flex justify-end">
                    <div className="inline-flex bg-gray-100 rounded-full p-0.5">
                        <button
                            onClick={() => setMemberMode(false)}
                            className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${!memberMode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Vue admin
                        </button>
                        <button
                            onClick={() => setMemberMode(true)}
                            className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${memberMode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Mon espace membre
                        </button>
                    </div>
                </div>
            )}
            {showAdmin ? <AdminView /> : <MemberView />}
        </div>
    );
}
