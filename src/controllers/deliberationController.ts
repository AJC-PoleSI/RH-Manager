import { Request, Response } from 'express';
import prisma from '../utils/prisma';

export const getAllDeliberations = async (req: Request, res: Response) => {
    try {
        const tour = parseInt(req.query.tour as string) || undefined;

        const candidates = await prisma.candidate.findMany({
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                comments: true,
                deliberation: true,
                evaluations: {
                    select: {
                        id: true,
                        scores: true,
                        comment: true,
                        memberId: true,
                        createdAt: true,
                        member: { select: { email: true } },
                        epreuve: {
                            select: {
                                id: true,
                                name: true,
                                tour: true,
                                type: true,
                            }
                        }
                    },
                    ...(tour ? { where: { epreuve: { tour } } } : {}),
                },
                wishes: {
                    select: { pole: true, rank: true },
                    orderBy: { rank: 'asc' }
                }
            },
            orderBy: { lastName: 'asc' }
        });

        res.json(candidates);
    } catch (error) {
        console.error('getAllDeliberations error:', error);
        res.status(500).json({ error: 'Failed to fetch deliberation data' });
    }
};

export const getDeliberation = async (req: Request, res: Response) => {
    const { candidateId } = req.params;
    try {
        const deliberation = await prisma.deliberation.findUnique({
            where: { candidateId },
        });
        res.json(deliberation || { status: 'No deliberation yet' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch deliberation' });
    }
};

export const updateDeliberation = async (req: Request, res: Response) => {
    const { candidateId } = req.params;
    const { tour1Status, tour2Status, tour3Status, globalComments, prosComment, consComment } = req.body;

    try {
        // Build data object only with provided fields (so partial updates work)
        const updateData: any = {};
        const createData: any = { candidateId };

        if (tour1Status !== undefined) { updateData.tour1Status = tour1Status; createData.tour1Status = tour1Status; }
        if (tour2Status !== undefined) { updateData.tour2Status = tour2Status; createData.tour2Status = tour2Status; }
        if (tour3Status !== undefined) { updateData.tour3Status = tour3Status; createData.tour3Status = tour3Status; }
        if (globalComments !== undefined) { updateData.globalComments = globalComments; createData.globalComments = globalComments; }
        if (prosComment !== undefined) { updateData.prosComment = prosComment; createData.prosComment = prosComment; }
        if (consComment !== undefined) { updateData.consComment = consComment; createData.consComment = consComment; }

        const deliberation = await prisma.deliberation.upsert({
            where: { candidateId },
            update: updateData,
            create: createData,
        });
        res.json(deliberation);
    } catch (error) {
        console.error('updateDeliberation error:', error);
        res.status(400).json({ error: 'Failed to update deliberation', details: error });
    }
};
