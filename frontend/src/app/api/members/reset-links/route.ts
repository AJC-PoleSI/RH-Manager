import { supabaseAdmin } from "@/lib/supabase";
import {
  getTokenFromRequest,
  unauthorized,
  forbidden,
  isSuperAdminEmail,
} from "@/lib/auth";
import { issueResetLink } from "@/lib/password-reset-service";
import { NextRequest } from "next/server";

// POST /api/members/reset-links   (admin uniquement)
//
// Body :
//   { memberId: "uuid" }  → un seul membre
//   { all: true }         → tous les membres
//   { forceChange: true } → marque aussi le compte « doit changer de mot de
//                           passe à la prochaine connexion »
//
// Envoie à chacun un lien pour choisir lui-même son mot de passe. Le
// super-admin est exclu des envois en masse (compte de secours : s'il perd
// l'accès à sa boîte, plus personne ne peut administrer la plateforme).
export async function POST(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  try {
    const { memberId, all, forceChange } = await req.json();

    if (!memberId && !all) {
      return Response.json(
        { error: "memberId ou all requis." },
        { status: 400 },
      );
    }

    let query = supabaseAdmin.from("members").select("id, email, first_name");
    if (memberId) query = query.eq("id", memberId);

    const { data: members, error } = await query;
    if (error) throw error;

    let targets = members || [];
    if (all) {
      targets = targets.filter((m: any) => !isSuperAdminEmail(m.email));
    }

    if (targets.length === 0) {
      return Response.json({ error: "Aucun membre ciblé." }, { status: 404 });
    }

    let sent = 0;
    const failed: string[] = [];
    let firstError: string | null = null;

    // Envoi séquentiel : Resend limite le débit, et un échec isolé ne doit
    // pas faire échouer les autres.
    for (const m of targets) {
      const res = await issueResetLink(m, "invite", !!forceChange);
      if (res.ok) {
        sent += 1;
      } else {
        failed.push(m.email);
        if (!firstError) firstError = res.error;
      }
    }

    // Zéro envoi = problème systémique (migration manquante, clé Resend…) :
    // on remonte l'erreur au lieu d'un faux succès.
    if (sent === 0) {
      return Response.json(
        { error: firstError || "Aucun email n'a pu être envoyé.", sent, failed },
        { status: 500 },
      );
    }

    return Response.json({ sent, failed, total: targets.length });
  } catch (error) {
    console.error("reset-links error:", error);
    return Response.json(
      { error: "Erreur lors de l'envoi des liens." },
      { status: 500 },
    );
  }
}
