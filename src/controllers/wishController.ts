import { Request, Response } from 'express';
import prisma from '../utils/prisma';

export const getWishes = async (req: Request, res: Response) => {
    const { candidateId } = req.params;
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

    if (!Array.isArray(wishes)) {
        return res.status(400).json({ error: 'wishes must be an array' });
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
