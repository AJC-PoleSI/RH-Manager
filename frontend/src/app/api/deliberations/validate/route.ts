import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { sendResultEmails } from "@/lib/resend";
import {
  refusalMessageKey,
  candidateRefusalMessageKey,
} from "@/lib/elimination";
import { NextRequest } from "next/server";

// POST /api/deliberations/validate — Admin uniquement.
// Body: {
//   tour: number,
//   mode?: "individual" | "global",
//   globalAccepted?: string,   // message commun aux admis (mode global)
//   globalRefused?: string,    // message commun aux refusés (mode global)
//   messages?: { [candidateId]: string }  // messages individualisés
//   candidateIds?: string[]    // restreint l'envoi (relance des échecs)
// }
// Envoie un email de résultat à chaque candidat ayant une décision
// (accepted / refused) pour ce tour. Débloque la validation du tour.
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const body = await req.json();
    const tour = Number(body.tour) || 1;
    const mode: "individual" | "global" =
      body.mode === "global" ? "global" : "individual";
    const globalAccepted: string = body.globalAccepted || "";
    const globalRefused: string = body.globalRefused || "";
    const messages: Record<string, string> = body.messages || {};
    const onlyIds: Set<string> | null = Array.isArray(body.candidateIds)
      ? new Set(body.candidateIds.map(String))
      : null;

    const tourCol = `tour${tour}_status`;

    // Candidats ayant une décision pour ce tour (admis ou refusé)
    const { data: delibs, error } = await supabaseAdmin
      .from("deliberations")
      .select(
        `candidate_id, ${tourCol}, candidate:candidates(id, first_name, email, email_verified)`,
      )
      .in(tourCol, ["accepted", "refused"]);

    if (error) throw error;

    const targets = (delibs || [])
      .map((d: any) => ({
        status: d[tourCol] as string,
        candidate: d.candidate,
      }))
      .filter((t: any) => t.candidate && t.candidate.email)
      .filter((t: any) => !onlyIds || onlyIds.has(t.candidate.id));

    if (targets.length === 0) {
      return Response.json(
        { error: "Aucun candidat avec une décision pour ce tour." },
        { status: 400 },
      );
    }

    const { sent, failedKeys } = await sendResultEmails(
      targets.map((t: any) => {
        const admis = t.status === "accepted";
        const message =
          mode === "global"
            ? admis
              ? globalAccepted
              : globalRefused
            : messages[t.candidate.id] || "";
        return {
          key: t.candidate.id as string,
          email: t.candidate.email,
          firstName: t.candidate.first_name || "",
          admis,
          tour,
          message,
        };
      }),
    );

    await saveRefusalMessages(
      tour,
      mode,
      globalRefused,
      messages,
      targets
        .filter((t: any) => t.status === "refused")
        .map((t: any) => t.candidate.id as string),
    );

    const failed = failedKeys.length;
    if (failed > 0) {
      console.error(
        `deliberations/validate: ${failed} email(s) en échec (tour ${tour})`,
      );
    }

    return Response.json({
      ok: true,
      tour,
      total: targets.length,
      sent,
      failed,
      failedCandidateIds: failedKeys,
    });
  } catch (error) {
    console.error("POST deliberations/validate error:", error);
    return Response.json(
      { error: "Échec de l'envoi des résultats" },
      { status: 500 },
    );
  }
}

// Garde le message de refus tel qu'envoyé : l'espace candidat d'un refusé le
// réaffiche à la place des créneaux (cf. /api/candidate-status). Un message
// individualisé prime sur le commun ; un envoi en mode commun efface donc les
// individualisés des mêmes candidats. Les emails sont déjà partis : un échec
// ici est journalisé, pas remonté.
async function saveRefusalMessages(
  tour: number,
  mode: "individual" | "global",
  globalRefused: string,
  messages: Record<string, string>,
  refusedIds: string[],
) {
  if (refusedIds.length === 0) return;
  const individualKeys = refusedIds.map((id) =>
    candidateRefusalMessageKey(tour, id),
  );
  try {
    if (mode === "global") {
      const { error } = await supabaseAdmin
        .from("system_settings")
        .upsert(
          { key: refusalMessageKey(tour), value: globalRefused },
          { onConflict: "key" },
        );
      if (error) throw error;
      const { error: delError } = await supabaseAdmin
        .from("system_settings")
        .delete()
        .in("key", individualKeys);
      if (delError) throw delError;
    } else {
      const { error } = await supabaseAdmin.from("system_settings").upsert(
        refusedIds.map((id, i) => ({
          key: individualKeys[i],
          value: messages[id] || "",
        })),
        { onConflict: "key" },
      );
      if (error) throw error;
    }
  } catch (error) {
    console.error(
      `deliberations/validate: message de refus non enregistré (tour ${tour})`,
      error,
    );
  }
}
