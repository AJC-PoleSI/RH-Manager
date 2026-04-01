import { Request, Response } from 'express';
import prisma from '../utils/prisma';

export const getAllEpreuves = async (req: Request, res: Response) => {
    try {
        const epreuves = await prisma.epreuve.findMany();
        // Parse JSON string fields if needed, but Prisma might return string. 
        // Client should handle parsing or we do it here. 
        // Since we used String type for JSON in Prisma schema (SQLite compat), we might need to parse.
        const parsedEpreuves = epreuves.map(e => ({
            ...e,
            evaluationQuestions: JSON.parse(e.evaluationQuestions || '[]')
        }));
        res.json(parsedEpreuves);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch epreuves' });
    }
};

export const createEreuve = async (req: Request, res: Response) => {
    try {
        const { name, tour, type, durationMinutes, evaluationQuestions, isPoleTest, pole } = req.body;
        const epreuve = await prisma.epreuve.create({
            data: {
                name,
                tour,
                type,
                durationMinutes,
                evaluationQuestions: JSON.stringify(evaluationQuestions),
                isPoleTest,
                pole
            },
        });
        res.status(201).json(epreuve);
    } catch (error) {
        res.status(400).json({ error: 'Failed to create epreuve', details: error });
    }
};

export const updateEpreuve = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const { name, tour, type, durationMinutes, evaluationQuestions, isPoleTest, pole } = req.body;

        // Construct cleaner update object to avoid passing extra fields/variants that Prisma hates
        const data: any = {};
        if (name !== undefined) data.name = name;
        if (tour !== undefined) data.tour = tour;
        if (type !== undefined) data.type = type;
        if (durationMinutes !== undefined) data.durationMinutes = durationMinutes;
        if (isPoleTest !== undefined) data.isPoleTest = isPoleTest;
        if (pole !== undefined) data.pole = pole;
        if (evaluationQuestions !== undefined) {
            // Handle both object (needs stringify) and already stringified cases if any legacy client exists
            data.evaluationQuestions = typeof evaluationQuestions === 'string'
                ? evaluationQuestions
                : JSON.stringify(evaluationQuestions);
        }
        // Phase 4: Visibility toggle
        if (req.body.isVisible !== undefined) data.isVisible = req.body.isVisible;

        const epreuve = await prisma.epreuve.update({
            where: { id },
            data,
        });
        res.json(epreuve);
    } catch (error) {
        console.error(error); // Add logging
        res.status(400).json({ error: 'Failed to update epreuve' });
    }
};

export const deleteEpreuve = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        await prisma.epreuve.delete({ where: { id } });
        res.status(204).send();
    } catch (error) {
        res.status(400).json({ error: 'Failed to delete epreuve' });
    }
};
