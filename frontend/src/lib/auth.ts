import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';

const JWT_SECRET: string = process.env.JWT_SECRET ?? (() => { throw new Error('FATAL: JWT_SECRET environment variable is not set.'); })();

export interface TokenPayload {
  id: string;
  email: string;
  role: 'member' | 'candidate';
  isAdmin?: boolean;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

export function getTokenFromRequest(req: NextRequest): TokenPayload | null {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  return verifyToken(token);
}

export function unauthorized() {
  return Response.json({ error: 'Non autorise' }, { status: 401 });
}

export function forbidden() {
  return Response.json({ error: 'Acces interdit' }, { status: 403 });
}
