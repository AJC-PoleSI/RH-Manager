import crypto from "crypto";
import { NextRequest } from "next/server";

// ════════════════════════════════════════════════════════════════════════
// Contrat d'intégration Befast ↔ RH Manager (voir docs/.../befast-rh-integration).
// Implémenté à l'identique dans les 3 surfaces (RH, Befast, Onboarding).
// ════════════════════════════════════════════════════════════════════════

function getSecret(): string {
  const secret = process.env.INTEGRATION_SECRET;
  if (!secret) {
    throw new Error("FATAL: INTEGRATION_SECRET is not set.");
  }
  return secret;
}

export const BEFAST_BASE_URL = (
  process.env.BEFAST_BASE_URL ?? "http://localhost:3001"
).replace(/\/+$/, "");

const MAX_SKEW_MS = 5 * 60 * 1000; // 5 min
const SSO_TTL_MS = 120 * 1000; // 120 s

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function hmacHex(data: string): string {
  return crypto.createHmac("sha256", SECRET).update(data).digest("hex");
}

function timingEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// ─── Requêtes internes signées (server-to-server) ──────────────────────────

export function signBody(rawBody: string): {
  timestamp: string;
  signature: string;
} {
  const timestamp = Date.now().toString();
  const signature = `sha256=${hmacHex(`${timestamp}.${rawBody}`)}`;
  return { timestamp, signature };
}

export function verifySignedRequest(req: NextRequest, rawBody: string): boolean {
  const timestamp = req.headers.get("x-int-timestamp");
  const signature = req.headers.get("x-int-signature");
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS)
    return false;
  const expected = `sha256=${hmacHex(`${timestamp}.${rawBody}`)}`;
  return timingEqual(signature, expected);
}

/** POST JSON signé vers une app partenaire. */
export async function postSigned(
  url: string,
  body: unknown,
): Promise<Response> {
  const rawBody = JSON.stringify(body ?? {});
  const { timestamp, signature } = signBody(rawBody);
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-int-timestamp": timestamp,
      "x-int-signature": signature,
    },
    body: rawBody,
  });
}

// ─── Token SSO / deep-link (login inter-apps) ──────────────────────────────

export type SsoTarget = "rh" | "befast";

export interface SsoPayload {
  purpose: "sso";
  email: string;
  target: SsoTarget;
  iat: number;
  exp: number;
}

export function signSsoToken(email: string, target: SsoTarget): string {
  const now = Date.now();
  const payload: SsoPayload = {
    purpose: "sso",
    email: email.trim().toLowerCase(),
    target,
    iat: now,
    exp: now + SSO_TTL_MS,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(hmacHex(body));
  return `${body}.${sig}`;
}

export function verifySsoToken(
  token: string,
  expectedTarget: SsoTarget,
): SsoPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expectedSig = b64url(hmacHex(body));
  if (!timingEqual(sig, expectedSig)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body).toString()) as SsoPayload;
    if (payload.purpose !== "sso") return null;
    if (payload.target !== expectedTarget) return null;
    if (typeof payload.exp !== "number" || Date.now() > payload.exp)
      return null;
    return payload;
  } catch {
    return null;
  }
}
