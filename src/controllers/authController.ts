import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../utils/prisma';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('FATAL: JWT_SECRET environment variable is not set.');
}

// L'auto-inscription des membres (comptes privilégiés du jury) est désactivée
// par défaut : les membres sont créés par un admin via POST /api/members.
// Mettre ALLOW_MEMBER_REGISTRATION=true pour la réactiver explicitement.
const ALLOW_MEMBER_REGISTRATION = process.env.ALLOW_MEMBER_REGISTRATION === 'true';

/** Comparaison à temps constant pour éviter les fuites par timing. */
function safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
}

// Password validation: min 8 chars, 1 uppercase, 1 number
function validatePassword(password: string): string | null {
    if (!password || password.length < 8) return 'Le mot de passe doit contenir au moins 8 caracteres.';
    if (!/[A-Z]/.test(password)) return 'Le mot de passe doit contenir au moins une majuscule.';
    if (!/[0-9]/.test(password)) return 'Le mot de passe doit contenir au moins un chiffre.';
    return null;
}

export const register = async (req: Request, res: Response) => {
    if (!ALLOW_MEMBER_REGISTRATION) {
        return res.status(403).json({ error: "L'inscription des membres est désactivée. Contactez un administrateur." });
    }

    const { email, password } = req.body;

    const pwError = validatePassword(password);
    if (pwError) return res.status(400).json({ error: pwError });

    try {
        const hashedPassword = await bcrypt.hash(password, 12);
        const member = await prisma.member.create({
            data: {
                email,
                passwordHash: hashedPassword,
                isAdmin: false, // SECURITY: always false on registration
            },
        });

        res.status(201).json({ message: 'Member created successfully', member: { id: member.id, email: member.email } });
    } catch (error) {
        // Message générique : ne pas révéler si l'email existe déjà (énumération).
        res.status(400).json({ error: 'Impossible de créer le compte.' });
    }
};

export const registerCandidate = async (req: Request, res: Response) => {
    const { firstName, lastName, email, phone } = req.body;

    if (!firstName || !lastName || !email) {
        return res.status(400).json({ error: 'Les champs Prenom, Nom et Email sont obligatoires.' });
    }

    try {
        const deadlineSetting = await prisma.systemSetting.findUnique({ where: { key: 'deadline_candidats' } });
        if (deadlineSetting?.value) {
            const deadline = new Date(deadlineSetting.value);
            if (new Date() > deadline) {
                return res.status(403).json({ error: 'Les inscriptions sont fermees. La date limite est depassee.' });
            }
        }

        const candidate = await prisma.candidate.create({
            data: {
                firstName,
                lastName,
                email,
                phone: phone || null,
            },
        });

        const token = jwt.sign(
            { candidateId: candidate.id, role: 'candidate' },
            JWT_SECRET,
            { expiresIn: '2h' }
        );

        res.status(201).json({ token, candidate: { id: candidate.id, email: candidate.email } });
    } catch (error: any) {
        if (error.code === 'P2002') {
            return res.status(400).json({ error: 'Un candidat avec cet email existe deja.' });
        }
        console.error('registerCandidate error:', error);
        res.status(400).json({ error: 'Echec de l\'inscription.' });
    }
};

export const candidateLogin = async (req: Request, res: Response) => {
    const { email, lastName } = req.body;

    if (!email || !lastName) {
        return res.status(400).json({ error: 'Email et nom requis.' });
    }

    try {
        const candidate = await prisma.candidate.findUnique({ where: { email } });

        // ⚠️ STOPGAP DE SÉCURITÉ : le nom de famille n'est PAS un secret. Cette
        // vérification ne constitue pas une authentification forte. Elle reste
        // acceptable UNIQUEMENT parce que (1) le rate-limiting /api/auth bride le
        // brute-force et (2) un token candidat est désormais confiné à ses
        // propres données (voir requireMember / allowSelfCandidateOrMember).
        // À REMPLACER par un vrai secret (lien magique / OTP envoyé par email).
        const provided = String(lastName).trim().toLowerCase();
        const actual = candidate ? candidate.lastName.trim().toLowerCase() : '';
        const ok = !!candidate && safeEqual(provided, actual);

        if (!ok) {
            return res.status(401).json({ error: 'Identifiants invalides.' });
        }

        const token = jwt.sign(
            { candidateId: candidate!.id, role: 'candidate' },
            JWT_SECRET,
            { expiresIn: '2h' }
        );

        res.json({ token, candidate: { id: candidate!.id, email: candidate!.email } });
    } catch (error) {
        res.status(500).json({ error: 'Erreur de connexion.' });
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
            { expiresIn: '2h' }
        );

        res.json({ token, member: { id: member.id, email: member.email, isAdmin: member.isAdmin } });
    } catch (error) {
        res.status(500).json({ error: 'Login failed' });
    }
};
