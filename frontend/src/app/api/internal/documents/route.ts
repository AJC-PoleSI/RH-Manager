import { supabaseAdmin } from "@/lib/supabase";
import { verifySignedRequest } from "@/lib/integration";
import { NextRequest } from "next/server";

// POST /api/internal/documents  (signé HMAC — poussé par Befast)
// Reçoit le payload CURÉ des documents candidat. RH stocke des références
// (jamais les fichiers) et ne lit jamais la base Befast → isolation.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (!verifySignedRequest(req, rawBody)) {
    return Response.json({ error: "Signature invalide." }, { status: 401 });
  }

  let payload: {
    email?: string;
    documents?: Array<{
      type?: string;
      filename?: string;
      signedUrl?: string;
      expiresAt?: string;
    }>;
    complete?: boolean;
  };
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch {
    return Response.json({ error: "JSON invalide." }, { status: 400 });
  }

  const email = String(payload.email ?? "").trim().toLowerCase();
  if (!email) {
    return Response.json({ error: "email requis." }, { status: 400 });
  }

  // On ne conserve que les champs attendus (défense en profondeur).
  const documents = (payload.documents ?? []).map((d) => ({
    type: String(d.type ?? ""),
    filename: String(d.filename ?? ""),
    signed_url: String(d.signedUrl ?? ""),
    expires_at: d.expiresAt ?? null,
  }));

  try {
    const { data: candidate } = await supabaseAdmin
      .from("candidates")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (!candidate) {
      return Response.json({ error: "Candidat introuvable." }, { status: 404 });
    }

    const { error } = await supabaseAdmin
      .from("candidates")
      .update({
        befast_documents: documents,
        befast_documents_complete: payload.complete ?? documents.length > 0,
      })
      .eq("id", candidate.id);

    if (error) {
      return Response.json(
        { error: "Update documents échoué.", details: error.message },
        { status: 500 },
      );
    }
    return Response.json({ ok: true, count: documents.length });
  } catch (e) {
    return Response.json(
      { error: "Erreur réception documents.", details: String(e) },
      { status: 500 },
    );
  }
}
