import api from '@/lib/api';
import { sanitizeSpreadsheetRow } from '@/lib/spreadsheet-safety';
import {
    averageOn20ByEpreuve,
    getTotalMaxPoints,
    hasAnyScore,
    sumScores,
    toTwenty,
} from '@/lib/evaluation-criteria';
import { isLegacyCollectiveNote } from '@/lib/group-evaluation-criteria';

/**
 * Export Excel des candidats (synthèse + détail des évaluations), réservé aux
 * admins côté API. Renvoie le nombre de candidats exportés ; lève une erreur
 * si l'export échoue (le toast est à la charge de l'appelant).
 */
export async function exportCandidatesXlsx(): Promise<number> {
    const XLSX = await import('xlsx');
    const res = await api.get('/candidates/export');
    const data: any[] = res.data?.data || [];

    // Examinateurs crédités d'une note : l'auteur + les co-examinateurs
    // inscrits au créneau pour une note partagée (binôme / collective),
    // y compris celui qui ne s'est pas connecté pour la saisir.
    const examinerNames = (e: any): string => {
        const list: any[] = e.examiners?.length
            ? e.examiners
            : e.members
                ? [{ firstName: e.members.first_name, lastName: e.members.last_name, email: e.members.email }]
                : [];
        const names = list
            .map((m) =>
                m.firstName
                    ? `${m.firstName} ${m.lastName || ''}`.trim()
                    : m.email || '',
            )
            .filter(Boolean);
        return names.join(' & ');
    };

    const parseScores = (raw: any): Record<string, number> => {
        try {
            const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (!obj || typeof obj !== 'object') return {};
            const out: Record<string, number> = {};
            Object.entries(obj).forEach(([k, v]) => {
                const n = Number(v);
                if (!isNaN(n)) out[k] = n;
            });
            return out;
        } catch { return {}; }
    };


    // ───────── Sheet 1: Synthèse (one row per candidate) ─────────
    const synthRows = data.map((c: any) => {
        const evals: any[] = c.candidate_evaluations || [];
        const evalsByTour: Record<number, any[]> = {};
        evals.forEach((e) => {
            const t = e.epreuves?.tour ?? 0;
            if (!evalsByTour[t]) evalsByTour[t] = [];
            evalsByTour[t].push(e);
        });

        // Même règle que la délibération : chaque évaluation ramenée en %
        // de son barème, moyenne par épreuve, pondération par le barème,
        // résultat /20. (Avant : moyenne brute des points par critère, où un
        // critère /5 pesait autant qu'un critère /20.)
        // Les anciennes « notes collectives » des épreuves de groupe
        // sont exclues : le travail du groupe est désormais noté à
        // part et n'entre pas dans la moyenne du candidat.
        const toScored = (list: any[]) =>
            list
                .filter((e) => hasAnyScore(e.scores) && !isLegacyCollectiveNote(e))
                .map((e) => ({
                    epreuveKey: e.epreuves?.id || e.epreuves?.name || 'sans-epreuve',
                    obtained: sumScores(e.scores),
                    maxTotal: getTotalMaxPoints(e.epreuves?.evaluation_questions),
                }));
        const tourAverage = (tour: number) =>
            averageOn20ByEpreuve(toScored(evalsByTour[tour] || []));

        const tourComments = (tour: number) =>
            (evalsByTour[tour] || [])
                .map((e) => {
                    const who = examinerNames(e) || 'Évaluateur';
                    const ep = e.epreuves?.name || '';
                    return e.comment ? `[${ep} — ${who}] ${e.comment}` : '';
                })
                .filter(Boolean)
                .join('\n');

        const globalAvg = averageOn20ByEpreuve(toScored(evals));

        const delib = Array.isArray(c.deliberation) ? c.deliberation[0] : c.deliberation;

        return {
            Prénom: c.first_name,
            Nom: c.last_name,
            Email: c.email,
            'Note Tour 1 (/20)': tourAverage(1),
            'Commentaires Tour 1': tourComments(1),
            'Note Tour 2 (/20)': tourAverage(2),
            'Commentaires Tour 2': tourComments(2),
            'Note Tour 3 (/20)': tourAverage(3),
            'Commentaires Tour 3': tourComments(3),
            'Note Globale (/20)': globalAvg,
            'Points forts (délibération)': delib?.pros_comment || '',
            'Points faibles (délibération)': delib?.cons_comment || '',
            'Commentaire général': delib?.global_comments || c.comments || '',
            'Statut Tour 1': delib?.tour1_status || '',
            'Statut Tour 2': delib?.tour2_status || '',
            'Statut Tour 3': delib?.tour3_status || '',
        };
    });

    // ───────── Sheet 2: Détail évaluations (one row per evaluation) ─────────
    const detailRows: any[] = [];
    data.forEach((c: any) => {
        const evals: any[] = c.candidate_evaluations || [];
        evals.forEach((e) => {
            const scores = parseScores(e.scores);
            const scoreEntries = Object.entries(scores);
            const maxTotal = getTotalMaxPoints(e.epreuves?.evaluation_questions);
            const total = sumScores(e.scores);
            const noteOn20 = hasAnyScore(e.scores) && maxTotal > 0 ? toTwenty(total, maxTotal) : null;
            detailRows.push({
                Prénom: c.first_name,
                Nom: c.last_name,
                Tour: e.epreuves?.tour ?? '',
                Épreuve: e.epreuves?.name || '',
                Type: e.epreuves?.type || '',
                Évaluateur: examinerNames(e),
                'Détail des notes': scoreEntries.map(([k, v]) => `${k}: ${v}`).join(' | '),
                Total: maxTotal > 0 ? `${total} / ${maxTotal}` : total,
                'Note /20': noteOn20,
                Commentaire: e.comment || '',
                Date: e.created_at ? new Date(e.created_at).toLocaleDateString('fr-FR') : '',
            });
        });
    });

    const wb = XLSX.utils.book_new();

    // Les valeurs libres (prénom, nom, commentaires) sont neutralisées
    // avant écriture : sans cela, un candidat inscrit sous
    // `=HYPERLINK(...)` fait exécuter une formule à l'ouverture du
    // fichier par le staff (audit sécurité du 07/09/2026).
    const ws1 = XLSX.utils.json_to_sheet(synthRows.map(sanitizeSpreadsheetRow));
    ws1['!cols'] = [
        { wch: 14 }, { wch: 16 }, { wch: 28 },
        { wch: 11 }, { wch: 40 },
        { wch: 11 }, { wch: 40 },
        { wch: 11 }, { wch: 40 },
        { wch: 13 },
        { wch: 40 }, { wch: 40 }, { wch: 40 },
        { wch: 13 }, { wch: 13 }, { wch: 13 },
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'Synthèse');

    const ws2 = XLSX.utils.json_to_sheet(detailRows.map(sanitizeSpreadsheetRow));
    ws2['!cols'] = [
        { wch: 14 }, { wch: 16 }, { wch: 6 }, { wch: 22 }, { wch: 14 },
        { wch: 22 }, { wch: 50 }, { wch: 10 }, { wch: 60 }, { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(wb, ws2, 'Détail évaluations');

    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `candidats_export_${today}.xlsx`);
    return synthRows.length;
}
