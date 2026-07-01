import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { allowSelfCandidateOrMember } from '../middlewares/authMiddleware';

export const getWishes = async (req: Request, res: Response) => {
    const { candidateId } = req.params;
    if (!allowSelfCandidateOrMember(req, candidateId)) {
        return res.status(403).json({ error: 'Accès interdit à ces vœux' });
    }
    try {
        const wishes = await prisma.candidateWish.findMany({
            where: { candidateId },
            orderBy: { rank: 'asc' },
        });
        res.json(wishes);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch wishes' });
    }
};

export const saveWishes = async (req: Request, res: Response) => {
    const { candidateId } = req.params;
    const { wishes } = req.body; // Array of { pole, rank }

    if (!allowSelfCandidateOrMember(req, candidateId)) {
        return res.status(403).json({ error: 'Accès interdit à ces vœux' });
    }

    if (!Array.isArray(wishes)) {
        return res.status(400).json({ error: 'wishes must be an array' });
    }

    // Validation serveur des bornes (évite les rangs négatifs / pôles vides).
    const validWishes = wishes.every(
        (w: any) =>
            w && typeof w.pole === 'string' && w.pole.trim().length > 0 &&
            Number.isInteger(w.rank) && w.rank >= 1 && w.rank <= 20
    );
    if (!validWishes) {
        return res.status(400).json({ error: 'Vœux invalides (pole requis, rank entier 1..20)' });
    }

    try {
        await prisma.$transaction([
            prisma.candidateWish.deleteMany({ where: { candidateId } }),
            ...wishes.map((w: { pole: string; rank: number }) =>
                prisma.candidateWish.create({
                    data: {
                        candidateId,
                        pole: w.pole,
                        rank: w.rank,
                    },
                })
            ),
        ]);

        const updated = await prisma.candidateWish.findMany({
            where: { candidateId },
            orderBy: { rank: 'asc' },
        });
        res.json(updated);
    } catch (error) {
        res.status(500).json({ error: 'Failed to save wishes' });
    }
};
