import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is not set. Server cannot start.');
}

export interface AuthRequest extends Request {
    user?: {
        userId: string;
        isAdmin: boolean;
        candidateId?: string;
        role?: string;
    };
}

export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access denied, token missing' });
    }

    try {
        // Épingle l'algorithme : empêche toute confusion d'algorithme (ex. « none »
        // ou substitution HS/RS) même si la lib change ses défauts.
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as any;
        (req as AuthRequest).user = {
            userId: decoded.userId || decoded.candidateId,
            isAdmin: decoded.isAdmin || false,
            candidateId: decoded.candidateId,
            role: decoded.role || 'member',
        };
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Invalid token' });
    }
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    const user = (req as AuthRequest).user;
    if (!user || !user.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

/**
 * Réserve la route aux membres/jury (et admins) : rejette les tokens de rôle
 * « candidate ». Les endpoints de gestion (liste des candidats, délibérations,
 * évaluations…) ne doivent JAMAIS être accessibles avec un token candidat.
 */
export const requireMember = (req: Request, res: Response, next: NextFunction) => {
    const user = (req as AuthRequest).user;
    if (!user || user.role === 'candidate') {
        return res.status(403).json({ error: 'Accès réservé aux membres' });
    }
    next();
};

/**
 * Autorise l'accès à une ressource scopée par candidat si l'appelant est
 * membre/admin OU s'il est le candidat propriétaire (`candidateId` du token ==
 * paramètre d'URL). Empêche les IDOR sur les vœux/délibérations d'un candidat.
 */
export const allowSelfCandidateOrMember = (req: Request, paramCandidateId: string): boolean => {
    const user = (req as AuthRequest).user;
    if (!user) return false;
    if (user.role !== 'candidate') return true; // membre/admin
    return !!user.candidateId && user.candidateId === paramCandidateId;
};
