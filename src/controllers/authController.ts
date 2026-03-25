import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

export const register = async (req: Request, res: Response) => {
    const { email, password, isAdmin } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const member = await prisma.member.create({
            data: {
                email,
                passwordHash: hashedPassword,
                isAdmin: isAdmin || false,
            },
        });

        res.status(201).json({ message: 'Member created successfully', member: { id: member.id, email: member.email } });
    } catch (error) {
        res.status(400).json({ error: 'Error creating member. Email might already exist.', details: error });
    }
};

export const registerCandidate = async (req: Request, res: Response) => {
    const { firstName, lastName, email, phone } = req.body;

    if (!firstName || !lastName || !email) {
        return res.status(400).json({ error: 'Les champs Prénom, Nom et Email sont obligatoires.' });
    }

    try {
        // Check if registration is still open (optional deadline check)
        const deadlineSetting = await prisma.systemSetting.findUnique({ where: { key: 'deadline_candidats' } });
        if (deadlineSetting?.value) {
            const deadline = new Date(deadlineSetting.value);
            if (new Date() > deadline) {
                return res.status(403).json({ error: 'Les inscriptions sont fermées. La date limite est dépassée.' });
            }
        }

        // Create the candidate
        const candidate = await prisma.candidate.create({
            data: {
                firstName,
                lastName,
                email,
                phone: phone || null,
            },
        });

        // Generate token immediately
        const token = jwt.sign(
            { candidateId: candidate.id, role: 'candidate' },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.status(201).json({ token, candidate });
    } catch (error: any) {
        if (error.code === 'P2002') {
            return res.status(400).json({ error: 'Un candidat avec cet email existe déjà. Utilisez "Se connecter" à la place.' });
        }
        console.error('registerCandidate error:', error);
        res.status(400).json({ error: 'Échec de l\'inscription.', details: String(error) });
    }
};

export const candidateLogin = async (req: Request, res: Response) => {
    const { email, lastName } = req.body;

    if (!email || !lastName) {
        return res.status(400).json({ error: 'Email et nom requis.' });
    }

    try {
        const candidate = await prisma.candidate.findUnique({ where: { email } });

        if (!candidate || candidate.lastName.toLowerCase() !== lastName.toLowerCase()) {
            return res.status(401).json({ error: 'Candidat introuvable ou nom incorrect.' });
        }

        const token = jwt.sign(
            { candidateId: candidate.id, role: 'candidate' },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ token, candidate });
    } catch (error) {
        res.status(500).json({ error: 'Erreur de connexion candidat.' });
    }
};

export const login = async (req: Request, res: Response) => {
    const { email, password } = req.body;

    try {
        const member = await prisma.member.findUnique({ where: { email } });

        if (!member) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, member.passwordHash);

        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { userId: member.id, isAdmin: member.isAdmin },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ token, member: { id: member.id, email: member.email, isAdmin: member.isAdmin } });
    } catch (error) {
        res.status(500).json({ error: 'Login failed' });
    }
};
