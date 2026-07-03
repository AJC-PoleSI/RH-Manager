import { supabaseAdmin } from "@/lib/supabase";
import { verifySignedRequest } from "@/lib/integration";
import { NextRequest } from "next/server";

// POST /api/internal/provision  (signé HMAC — appelé par Befast, le maître)
// Crée ou met à jour le candidat RH miroir. Idempotent, keyé sur l'email.
// L'email est déjà vérifié centralement côté Befast → email_verified = true.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (!verifySignedRequest(req, rawBody)) {
    return Response.json({ error: "Signature invalide." }, { status: 401 });
  }

  let payload: {
    email?: string;
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
    befastPersonId?: string;
    source?: string;
  };
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch {
    return Response.json({ error: "JSON invalide." }, { status: 400 });
  }

  const email = String(payload.email ?? "").trim().toLowerCase();
  if (!email || !payload.firstName || !payload.lastName) {
    return Response.json(
      { error: "email, firstName, lastName requis." },
      { status: 400 },
    );
  }

  try {
    const { data: existing } = await supabaseAdmin
      .from("candidates")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from("candidates")
        .update({
          befast_person_id: payload.befastPersonId ?? null,
          onboarding_source: payload.source ?? "befast_direct",
          email_verified: true,
        })
        .eq("id", existing.id);
      return Response.json({ candidateId: existing.id, created: false });
    }

    const { data: created, error } = await supabaseAdmin
      .from("candidates")
      .insert({
        first_name: payload.firstName,
        last_name: payload.lastName,
        email,
        date_of_birth: payload.dateOfBirth ?? null,
        email_verified: true,
        befast_person_id: payload.befastPersonId ?? null,
        onboarding_source: payload.source ?? "onboarding",
      })
      .select("id")
      .single();

    if (error) {
      return Response.json(
        { error: "Insert candidat échoué.", details: error.message },
        { status: 500 },
      );
    }
    return Response.json({ candidateId: created.id, created: true });
  } catch (e) {
    return Response.json(
      { error: "Erreur provisioning.", details: String(e) },
      { status: 500 },
    );
  }
}
