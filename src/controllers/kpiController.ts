import { Request, Response } from 'express';
import prisma from '../utils/prisma';

export const getGlobalKPIs = async (req: Request, res: Response) => {
    try {
        const [totalCandidates, totalEvaluations, totalEpreuves, totalMembers, evaluationsPerMember] = await prisma.$transaction([
            prisma.candidate.count(),
            prisma.candidateEvaluation.count(),
            prisma.epreuve.count(),
            prisma.member.count(),
            prisma.candidateEvaluation.groupBy({
                by: ['memberId'],
                _count: { id: true },
                orderBy: {
                    _count: {
                        id: 'desc'
                    }
                }
            })
        ]);

        res.json({
            totalCandidates,
            totalEvaluations,
            totalEpreuves,
            totalMembers,
            evaluationsPerMember,
        });
    } catch (error) {
        console.error("KPI Error:", error);
        res.status(500).json({ error: 'Failed to fetch KPIs' });
    }
};
