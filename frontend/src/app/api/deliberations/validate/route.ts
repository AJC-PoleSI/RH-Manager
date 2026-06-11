import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { sendResultEmail } from "@/lib/resend";
import { NextRequest } from "next/server";

// POST /api/deliberations/validate — Admin uniquement.
// Body: {
//   tour: number,
//   mode?: "individual" | "global",
//   globalAccepted?: string,   // message commun aux admis (mode global)
//   globalRefused?: string,    // message commun aux refusés (mode global)
//   messages?: { [candidateId]: string }  // messages individualisés
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
      .filter((t: any) => t.candidate && t.candidate.email);

    if (targets.length === 0) {
      return Response.json(
        { error: "Aucun candidat avec une décision pour ce tour." },
        { status: 400 },
      );
    }

    const results = await Promise.allSettled(
      targets.map((t: any) => {
        const admis = t.status === "accepted";
        const message =
          mode === "global"
            ? admis
              ? globalAccepted
              : globalRefused
            : messages[t.candidate.id] || "";
        return sendResultEmail(
          t.candidate.email,
          t.candidate.first_name || "",
          admis,
          tour,
          message,
        );
      }),
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - sent;
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
    });
  } catch (error) {
    console.error("POST deliberations/validate error:", error);
    return Response.json(
      { error: "Échec de l'envoi des résultats" },
      { status: 500 },
    );
  }
}
