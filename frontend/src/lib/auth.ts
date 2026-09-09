import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";

const JWT_SECRET: string =
  process.env.JWT_SECRET ??
  (() => {
    throw new Error("FATAL: JWT_SECRET environment variable is not set.");
  })();

export interface TokenPayload {
  id: string;
  email: string;
  role: "member" | "candidate";
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
}

// Le compte super-admin (« admin admin ») est le seul protégé : non
// supprimable, vue admin pure (pas de fonctions membre). Identifié par son
// email, surchargeable via env.
export const SUPER_ADMIN_EMAIL = (
  process.env.SUPER_ADMIN_EMAIL ?? "admin@ajc.fr"
)
  .trim()
  .toLowerCase();

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}

export function signToken(payload: TokenPayload): string {
  // 8h : couvre une journée de travail sans reconnexion forcée. Une session
  // qui expire déclenche une redirection dure vers /login (cf. l'intercepteur
  // 401 de api.ts) — les 2h précédentes coupaient trop souvent des sessions
  // de saisie encore actives (constaté en prod le 09/09/2026).
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

export function getTokenFromRequest(req: NextRequest): TokenPayload | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7);
  return verifyToken(token);
}

export function unauthorized() {
  return Response.json({ error: "Non autorise" }, { status: 401 });
}

export function forbidden() {
  return Response.json({ error: "Acces interdit" }, { status: 403 });
}
