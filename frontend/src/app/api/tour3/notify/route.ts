import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { notifyMembers } from "@/lib/notifications";
import { sendPoleNotificationEmail } from "@/lib/resend";
import { NextRequest } from "next/server";

// POST /api/tour3/notify — Admin uniquement.
// Body: { pole }
// Prévient tous les membres du pôle (notification in-app + email) que des
// candidats ont demandé leur pôle et qu'ils doivent assurer des créneaux
// d'entretien.
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const { pole } = await req.json();
    if (!pole || typeof pole !== "string") {
      return Response.json({ error: "pole requis" }, { status: 400 });
    }

    // 1. Candidats distincts ayant demandé ce pôle
    const { data: wishes, error: wishErr } = await supabaseAdmin
      .from("candidate_wishes")
      .select("candidate_id")
      .eq("pole", pole);
    if (wishErr) throw wishErr;

    const candidatsCount = new Set(
      (wishes || []).map((w: any) => w.candidate_id),
    ).size;

    if (candidatsCount === 0) {
      return Response.json(
        { error: `Aucun candidat n'a demandé le pôle ${pole}.` },
        { status: 400 },
      );
    }

    // 2. Membres du pôle
    const { data: members, error: memErr } = await supabaseAdmin
      .from("members")
      .select("id, email, first_name")
      .eq("pole", pole)
      .eq("is_admin", false);
    if (memErr) throw memErr;

    if (!members || members.length === 0) {
      return Response.json(
        { error: `Aucun membre dans le pôle ${pole}.` },
        { status: 400 },
      );
    }

    const creneauxParMembre = Math.ceil(candidatsCount / members.length);

    // 3. Notifications in-app
    const notified = await notifyMembers(
      members.map((m: any) => m.id),
      {
        type: "tour3",
        title: `Tour 3 — Pôle ${pole}`,
        body: `${candidatsCount} candidat${candidatsCount > 1 ? "s" : ""} ${candidatsCount > 1 ? "ont" : "a"} demandé votre pôle. Minimum ${creneauxParMembre} créneau${creneauxParMembre > 1 ? "x" : ""} d'entretien par membre.`,
        link: "/dashboard/planning",
      },
    );

    // 4. Emails (fail-soft individuellement : un email en erreur ne doit
    // pas faire échouer les autres)
    const emailResults = await Promise.allSettled(
      (members || []).map((m: any) =>
        sendPoleNotificationEmail(
          m.email,
          m.first_name || "",
          pole,
          candidatsCount,
          creneauxParMembre,
        ),
      ),
    );
    const emailed = emailResults.filter(
      (r) => r.status === "fulfilled",
    ).length;
    const emailErrors = emailResults.length - emailed;
    if (emailErrors > 0) {
      console.error(
        `tour3/notify: ${emailErrors} email(s) en échec pour le pôle ${pole}`,
      );
    }

    return Response.json({
      ok: true,
      pole,
      candidatsCount,
      membersCount: members.length,
      notified,
      emailed,
    });
  } catch (error) {
    console.error("POST tour3/notify error:", error);
    return Response.json(
      { error: "Erreur lors de l'envoi des notifications" },
      { status: 500 },
    );
  }
}
