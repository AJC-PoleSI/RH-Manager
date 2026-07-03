import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { signSsoToken, BEFAST_BASE_URL } from "@/lib/integration";
import { NextRequest } from "next/server";

// GET /api/sso/switch  (bouton « Aller sur BeFast » côté RH)
// Authentifié par le JWT RH (Bearer). Renvoie l'URL signée vers le consume
// BeFast ; le client fait la redirection (le header Bearer ne suit pas un <a>).
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  const token = signSsoToken(payload.email, "befast");
  const url = `${BEFAST_BASE_URL}/api/sso/consume?token=${token}`;
  return Response.json({ url });
}
