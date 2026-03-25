import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import bcrypt from 'bcryptjs';

export const createMember = async (req: Request, res: Response) => {
    try {
        const { email, password, isAdmin } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const member = await prisma.member.create({
            data: {
                email,
                passwordHash,
                isAdmin: isAdmin || false
            },
            select: { id: true, email: true, isAdmin: true }
        });
        res.status(201).json(member);
    } catch (error: any) {
        if (error.code === 'P2002') {
            return res.status(400).json({ error: 'Email already exists' });
        }
        res.status(400).json({ error: 'Failed to create member' });
    }
};

export const getAllMembers = async (req: Request, res: Response) => {
    try {
        const members = await prisma.member.findMany({
            select: { id: true, email: true, isAdmin: true } // Don't return password hash
        });
        res.json(members);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch members' });
    }
};

export const getMemberById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const member = await prisma.member.findUnique({
            where: { id },
            select: { id: true, email: true, isAdmin: true, availabilities: true }
        });
        if (!member) {
            return res.status(404).json({ error: 'Member not found' });
        }
        res.json(member);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch member' });
    }
};

export const updateMember = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { email, password, isAdmin } = req.body;

    try {
        const data: any = { email, isAdmin };
        if (password) {
            data.passwordHash = await bcrypt.hash(password, 10);
        }

        const member = await prisma.member.update({
            where: { id },
            data,
            select: { id: true, email: true, isAdmin: true }
        });
        res.json(member);
    } catch (error) {
        res.status(400).json({ error: 'Failed to update member' });
    }
};

export const deleteMember = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        await prisma.member.delete({ where: { id } });
        res.status(204).send();
    } catch (error) {
        res.status(400).json({ error: 'Failed to delete member' });
    }
};
