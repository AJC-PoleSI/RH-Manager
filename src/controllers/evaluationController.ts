import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middlewares/authMiddleware';

export const submitEvaluation = async (req: Request, res: Response) => {
    const { candidateId, epreuveId, scores, comment } = req.body;
    const memberId = (req as AuthRequest).user?.userId;

    if (!memberId) {
        return res.status(401).json({ error: 'User not authenticated' });
    }

    try {
        const evaluation = await prisma.candidateEvaluation.create({
            data: {
                candidateId,
                epreuveId,
                memberId,
                scores: JSON.stringify(scores),
                comment,
            },
        });

        // Create EvaluatorTracking
        await prisma.evaluatorTracking.create({
            data: {
                memberId,
                candidateId,
                evaluationId: evaluation.id,
            },
        });

        res.status(201).json(evaluation);
    } catch (error) {
        res.status(400).json({ error: 'Failed to submit evaluation', details: error });
    }
};

export const getEvaluationsByCandidate = async (req: Request, res: Response) => {
    const { candidateId } = req.params;
    try {
        const evaluations = await prisma.candidateEvaluation.findMany({
            where: { candidateId },
            include: { epreuve: true, member: { select: { email: true } } },
        });
        const parsed = evaluations.map(e => ({
            ...e,
            scores: JSON.parse(e.scores),
        }));
        res.json(parsed);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch evaluations' });
    }
};

export const getEvaluationsByMember = async (req: Request, res: Response) => {
    const memberId = (req as AuthRequest).user?.userId;
    if (!memberId) {
        return res.status(401).json({ error: 'User not authenticated' });
    }

    try {
        const evaluations = await prisma.candidateEvaluation.findMany({
            where: { memberId },
            include: { candidate: true, epreuve: true },
        });
        const parsed = evaluations.map(e => ({
            ...e,
            scores: JSON.parse(e.scores),
        }));
        res.json(parsed);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch evaluations' });
    }
};

export const getAllEvaluatorTracking = async (req: Request, res: Response) => {
    try {
        const tracking = await prisma.evaluatorTracking.findMany({
            include: {
                member: { select: { email: true, id: true } },
                candidate: { select: { firstName: true, lastName: true, id: true } },
                evaluation: { select: { scores: true, comment: true, epreuve: { select: { name: true } } } }
            }
        });
        res.json(tracking);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch tracking data' });
    }
};
