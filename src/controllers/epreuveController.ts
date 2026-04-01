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
            evaluationQuestions: JSON.parse(e.evaluationQuestions || '[]'),
            description: e.description || null,
        }));
        res.json(parsedEpreuves);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch epreuves' });
    }
};

export const createEreuve = async (req: Request, res: Response) => {
    try {
        const body = req.body;
        const data: any = {
            name: body.name,
            tour: body.tour ?? 1,
            type: body.type ?? 'Entretien',
            durationMinutes: body.durationMinutes ?? 30,
            evaluationQuestions: typeof body.evaluationQuestions === 'string'
                ? body.evaluationQuestions
                : JSON.stringify(body.evaluationQuestions || []),
            isPoleTest: body.isPoleTest ?? false,
            pole: body.pole || null,
        };

        // Optional fields — only pass fields that exist in the Prisma Epreuve model
        if (body.roulementMinutes !== undefined) data.roulementMinutes = body.roulementMinutes;
        if (body.nbSalles !== undefined) data.nbSalles = body.nbSalles;
        if (body.minEvaluatorsPerSalle !== undefined) data.minEvaluatorsPerSalle = body.minEvaluatorsPerSalle;
        if (body.dateDebut) data.dateDebut = body.dateDebut;
        if (body.dateFin) data.dateFin = body.dateFin;
        if (body.description) data.description = body.description;
        if (body.isVisible !== undefined) data.isVisible = body.isVisible;
        if (body.isGroupEpreuve !== undefined) data.isGroupEpreuve = body.isGroupEpreuve;
        if (body.groupSize !== undefined) data.groupSize = body.groupSize;

        // NOTE: fields like date, time, salle, presentedBy, documentsUrls
        // are NOT in the Prisma Epreuve model and must NOT be passed to prisma.create()

        const epreuve = await prisma.epreuve.create({ data });
        res.status(201).json(epreuve);
    } catch (error) {
        console.error('Create epreuve error:', error);
        res.status(400).json({ error: 'Failed to create epreuve', details: String(error) });
    }
};

export const updateEpreuve = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const body = req.body;
        const data: any = {};

        if (body.name !== undefined) data.name = body.name;
        if (body.tour !== undefined) data.tour = body.tour;
        if (body.type !== undefined) data.type = body.type;
        if (body.durationMinutes !== undefined) data.durationMinutes = body.durationMinutes;
        if (body.roulementMinutes !== undefined) data.roulementMinutes = body.roulementMinutes;
        if (body.nbSalles !== undefined) data.nbSalles = body.nbSalles;
        if (body.minEvaluatorsPerSalle !== undefined) data.minEvaluatorsPerSalle = body.minEvaluatorsPerSalle;
        if (body.dateDebut !== undefined) data.dateDebut = body.dateDebut;
        if (body.dateFin !== undefined) data.dateFin = body.dateFin;
        if (body.isPoleTest !== undefined) data.isPoleTest = body.isPoleTest;
        if (body.pole !== undefined) data.pole = body.pole;
        if (body.description !== undefined) data.description = body.description;
        if (body.isVisible !== undefined) data.isVisible = body.isVisible;
        if (body.evaluationQuestions !== undefined) {
            data.evaluationQuestions = typeof body.evaluationQuestions === 'string'
                ? body.evaluationQuestions
                : JSON.stringify(body.evaluationQuestions);
        }

        const epreuve = await prisma.epreuve.update({
            where: { id },
            data,
        });
        res.json(epreuve);
    } catch (error) {
        console.error('Update epreuve error:', error);
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
