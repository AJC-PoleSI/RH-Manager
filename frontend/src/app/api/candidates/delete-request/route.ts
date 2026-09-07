import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized } from "@/lib/auth";
import { sendAccountDeletionRequestEmail } from "@/lib/resend";
import { NextRequest } from "next/server";

// Destinataire des notifications d'administration, surchargeable par
// environnement pour ne pas polluer la boîte réelle en préproduction.
const ADMIN_EMAIL =
  process.env.ADMIN_NOTIFICATION_EMAIL ?? "systeme.info@ajc-mail.com";
const MOTIF_MAX = 1000;

// POST /api/candidates/delete-request
// Le candidat demande la suppression de SON compte. Rien n'est supprimé ici :
// l'email prévient l'administration, qui traite la demande à la main.
// L'identité vient de la base à partir du jeton — le corps de la requête ne
// porte que le motif.
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();

  try {
    const body = await req.json().catch(() => ({}));
    const motif =
      typeof body?.motif === "string" ? body.motif.trim().slice(0, MOTIF_MAX) : "";

    const { data: candidate, error } = await supabaseAdmin
      .from("candidates")
      .select("id, first_name, last_name, email")
      .eq("id", payload.id)
      .single();

    if (error || !candidate) {
      return Response.json({ error: "Profil introuvable" }, { status: 404 });
    }

    // Cette demande RGPD n'est stockée nulle part : l'email est son UNIQUE
    // canal de transmission. Le SDK Resend ne lève pas d'exception sur une
    // erreur d'API (domaine non validé, quota, adresse refusée) — il renvoie
    // `{ data, error }`. Avant l'audit du 07/09/2026, ce retour n'était jamais
    // lu et le candidat recevait `ok:true` même quand rien n'était parti.
    const sent = await sendAccountDeletionRequestEmail({
      to: ADMIN_EMAIL,
      candidateId: candidate.id,
      firstName: candidate.first_name,
      lastName: candidate.last_name,
      email: candidate.email,
      motif: motif || null,
    });

    if (sent?.error) {
      // Trace serveur exploitable : la demande reste récupérable dans les logs
      // même si l'email n'est jamais arrivé.
      console.error(
        "[candidates/delete-request] ÉCHEC D'ENVOI — demande RGPD à traiter " +
          `manuellement : candidat ${candidate.id} <${candidate.email}>` +
          (motif ? ` — motif: ${motif}` : ""),
        sent.error,
      );
      return Response.json(
        {
          error:
            "Votre demande n'a pas pu être transmise. Réessayez dans quelques " +
            "minutes ou écrivez directement à " + ADMIN_EMAIL + ".",
        },
        { status: 502 },
      );
    }

    return Response.json({ ok: true });
  } catch (e) {
    console.error("[candidates/delete-request]", e);
    return Response.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
