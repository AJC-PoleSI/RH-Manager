import { Request, Response } from 'express';
import prisma from '../utils/prisma';

export const getAllCandidates = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const search = req.query.search as string || '';
        const skip = (page - 1) * limit;

        const where: any = {};
        if (search) {
            where.OR = [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
            ];
        }

        const [candidates, total] = await prisma.$transaction([
            prisma.candidate.findMany({
                where,
                skip,
                take: limit,
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
                        }
                    }
                }
                // orderBy: { createdAt: 'desc' } 
            }),
            prisma.candidate.count({ where })
        ]);

        res.json({
            data: candidates,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch candidates' });
    }
};

export const getCandidateById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const candidate = await prisma.candidate.findUnique({
            where: { id },
            include: { evaluations: true, deliberation: true }
        });
        if (!candidate) {
            return res.status(404).json({ error: 'Candidate not found' });
        }
        res.json(candidate);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch candidate' });
    }
};

export const createCandidate = async (req: Request, res: Response) => {
    try {
        const { firstName, lastName, email, phone } = req.body;

        // Basic validation
        if (!firstName || !lastName || !email) {
            return res.status(400).json({ error: 'Les champs Prénom, Nom et Email sont obligatoires.' });
        }

        const candidate = await prisma.candidate.create({
            data: {
                firstName,
                lastName,
                email,
                phone: phone || null // Convert empty string to null if preferred, or keep as string. Prisma allows empty strings.
            },
        });
        res.status(201).json(candidate);
    } catch (error: any) {
        // Handle Unique Constraint
        if (error.code === 'P2002') {
            return res.status(400).json({ error: 'Un candidat avec cet email existe déjà.' });
        }
        console.error("Create Candidate Error:", error);
        res.status(400).json({ error: 'Échec de la création du candidat.', details: String(error) });
    }
};

export const updateCandidate = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const candidate = await prisma.candidate.update({
            where: { id },
            data: req.body,
        });
        res.json(candidate);
    } catch (error) {
        res.status(400).json({ error: 'Failed to update candidate' });
    }
};

export const deleteCandidate = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        await prisma.candidate.delete({ where: { id } });
        res.status(204).send();
    } catch (error) {
        res.status(400).json({ error: 'Failed to delete candidate' });
    }
};
