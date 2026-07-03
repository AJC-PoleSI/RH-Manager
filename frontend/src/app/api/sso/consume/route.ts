import { supabaseAdmin } from "@/lib/supabase";
import { signToken } from "@/lib/auth";
import { verifySsoToken } from "@/lib/integration";
import { NextRequest } from "next/server";

// GET /api/sso/consume?token=…  (switch depuis Befast)
// Vérifie le token SSO court, retrouve le candidat par email, émet le JWT RH
// et le pose dans localStorage côté client avant de rediriger vers l'app.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const payload = verifySsoToken(token, "rh");

  const fail = (msg: string) =>
    new Response(errorHtml(msg), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });

  if (!payload) return fail("Lien de connexion invalide ou expiré.");

  const email = payload.email.trim().toLowerCase();
  const { data: candidate } = await supabaseAdmin
    .from("candidates")
    .select("id, email, email_verified")
    .eq("email", email)
    .maybeSingle();

  if (!candidate) return fail("Aucun compte RH Manager pour cette adresse.");

  const jwt = signToken({
    id: candidate.id,
    email: candidate.email,
    role: "candidate",
  });

  return new Response(successHtml(jwt), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function successHtml(jwt: string): string {
  // jwt est du base64url/JWON sûr, mais on l'injecte via JSON.stringify.
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Connexion…</title></head>
<body style="font-family:system-ui;background:#0b1437;color:#fff;display:flex;height:100vh;align-items:center;justify-content:center;margin:0">
<p>Connexion en cours…</p>
<script>
  try { localStorage.setItem("token", ${JSON.stringify(jwt)}); } catch (e) {}
  window.location.replace("/");
</script>
</body></html>`;
}

function errorHtml(msg: string): string {
  const safe = msg.replace(/</g, "&lt;");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Erreur</title></head>
<body style="font-family:system-ui;background:#0b1437;color:#fff;display:flex;height:100vh;align-items:center;justify-content:center;margin:0">
<div style="text-align:center"><p>${safe}</p><p><a style="color:#caa64b" href="/login">Se connecter</a></p></div>
</body></html>`;
}
