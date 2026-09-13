import { supabaseAdmin } from "@/lib/supabase";
import {
  getTokenFromRequest,
  unauthorized,
  forbidden,
  isSuperAdminEmail,
} from "@/lib/auth";
import { fetchAllRows } from "@/lib/supabase-paging";
import {
  CandidateFilter,
  EMAIL_DAILY_CAP,
  candidateMatchesFilter,
  isCandidateFilter,
  startOfUtcDay,
} from "@/lib/announcements";
import { sendAnnouncementEmails } from "@/lib/resend";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

interface MemberRow {
  id: string;
  email: string;
  first_name: string | null;
  pole: string | null;
}

interface CandidateRow {
  id: string;
  email: string | null;
  first_name: string | null;
}

interface DelibRow {
  candidate_id: string;
  tour1_status: string | null;
  tour2_status: string | null;
  tour3_status: string | null;
}

/** La table n'existe pas encore côté Supabase (migration 13 non appliquée). */
function isMissingTable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "PGRST205";
}

function migrationRequired() {
  return Response.json(
    {
      error:
        "Les tables d'annonces n'existent pas encore. Applique la section 13 " +
        "de MIGRATIONS_A_APPLIQUER.sql dans le SQL Editor de Supabase.",
    },
    { status: 503 },
  );
}

/**
 * Audience réelle de l'annonce.
 *
 * Toutes les lectures passent par `fetchAllRows` : PostgREST tronque
 * silencieusement à 1000 lignes, et une audience tronquée = des gens qui ne
 * reçoivent jamais le message, sans la moindre erreur.
 */
async function resolveAudience(opts: {
  targetMembers: boolean;
  memberPole: string | null;
  targetCandidates: boolean;
  candidateFilter: CandidateFilter;
}) {
  let members: MemberRow[] = [];
  let candidates: CandidateRow[] = [];

  if (opts.targetMembers) {
    const { data, error } = await fetchAllRows<MemberRow>((from, to) =>
      supabaseAdmin
        .from("members")
        .select("id, email, first_name, pole")
        .order("id")
        .range(from, to),
    );
    if (error) throw error;
    // Le super-admin est un compte technique, pas une personne à prévenir.
    members = (data || []).filter((m) => !isSuperAdminEmail(m.email));
    if (opts.memberPole) {
      members = members.filter((m) => m.pole === opts.memberPole);
    }
  }

  if (opts.targetCandidates) {
    const [{ data: cands, error: candErr }, { data: delibs, error: delibErr }] =
      await Promise.all([
        fetchAllRows<CandidateRow>((from, to) =>
          supabaseAdmin
            .from("candidates")
            .select("id, email, first_name")
            .order("id")
            .range(from, to),
        ),
        fetchAllRows<DelibRow>((from, to) =>
          supabaseAdmin
            .from("deliberations")
            .select("candidate_id, tour1_status, tour2_status, tour3_status")
            .order("candidate_id")
            .range(from, to),
        ),
      ]);
    if (candErr) throw candErr;
    if (delibErr) throw delibErr;

    const byCandidate = new Map((delibs || []).map((d) => [d.candidate_id, d]));
    candidates = (cands || []).filter((c) =>
      candidateMatchesFilter(opts.candidateFilter, byCandidate.get(c.id)),
    );
  }

  return { members, candidates };
}

/**
 * Emails d'annonces déjà partis aujourd'hui (fenêtre UTC, comme Resend).
 *
 * Renvoie `null` si la table n'existe pas encore : l'aperçu doit rester
 * utilisable avant l'application de la migration (sinon l'admin n'a qu'un
 * compteur qui tourne dans le vide, sans savoir pourquoi).
 */
async function emailsSentToday(): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from("announcements")
    .select("email_sent")
    .gte("created_at", startOfUtcDay());
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return (data || []).reduce(
    (sum: number, row: { email_sent: number | null }) =>
      sum + (row.email_sent || 0),
    0,
  );
}

/** Liste des pôles renseignés côté membres, pour alimenter le filtre de l'UI. */
async function listPoles(): Promise<{ pole: string; count: number }[]> {
  const { data, error } = await fetchAllRows<{ email: string; pole: string | null }>(
    (from, to) =>
      supabaseAdmin.from("members").select("email, pole").order("email").range(from, to),
  );
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const m of data || []) {
    if (!m.pole || isSuperAdminEmail(m.email)) continue;
    counts.set(m.pole, (counts.get(m.pole) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([pole, count]) => ({ pole, count }))
    .sort((a, b) => a.pole.localeCompare(b.pole, "fr"));
}

// GET /api/announcements — historique des annonces (admin).
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const { data, error } = await supabaseAdmin
      .from("announcements")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;

    return Response.json({
      dailyCap: EMAIL_DAILY_CAP,
      emailsSentToday: (await emailsSentToday()) ?? 0,
      announcements: (data || []).map((a: any) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        targetMembers: a.target_members,
        memberPole: a.member_pole,
        targetCandidates: a.target_candidates,
        candidateFilter: a.candidate_filter,
        membersCount: a.members_count,
        candidatesCount: a.candidates_count,
        emailSent: a.email_sent,
        emailFailed: a.email_failed,
        createdByName: a.created_by_name,
        createdAt: a.created_at,
      })),
    });
  } catch (error) {
    if (isMissingTable(error)) return migrationRequired();
    console.error("Announcements GET error:", error);
    return Response.json(
      { error: "Impossible de charger les annonces" },
      { status: 500 },
    );
  }
}

// POST /api/announcements — admin uniquement.
// Body: { title, body, targetMembers, memberPole, targetCandidates,
//         candidateFilter, sendEmail, dryRun }
//
// `dryRun: true` ne écrit rien : il renvoie l'audience exacte et l'état du
// quota email. L'aperçu et l'envoi partagent volontairement le même calcul.
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const raw = await req.json().catch(() => ({}));
    const dryRun = raw?.dryRun === true;
    const title = String(raw?.title || "").trim().slice(0, 150);
    const body = String(raw?.body || "").trim().slice(0, 5000);
    const targetMembers = raw?.targetMembers === true;
    const targetCandidates = raw?.targetCandidates === true;
    const memberPole =
      typeof raw?.memberPole === "string" && raw.memberPole.trim()
        ? raw.memberPole.trim()
        : null;
    const candidateFilter: CandidateFilter = isCandidateFilter(
      raw?.candidateFilter,
    )
      ? raw.candidateFilter
      : "all";
    const sendEmail = raw?.sendEmail === true;

    if (!targetMembers && !targetCandidates) {
      return Response.json(
        { error: "Choisis au moins une audience (membres et/ou candidats)." },
        { status: 400 },
      );
    }

    const { members, candidates } = await resolveAudience({
      targetMembers,
      memberPole,
      targetCandidates,
      candidateFilter,
    });

    const emailTargets = [
      ...members.map((m) => ({ email: m.email, firstName: m.first_name })),
      ...candidates
        .filter((c) => !!c.email)
        .map((c) => ({ email: c.email as string, firstName: c.first_name })),
    ];

    const sentToday = await emailsSentToday();
    const migrationPending = sentToday === null;
    const alreadySent = sentToday ?? 0;
    const remaining = Math.max(0, EMAIL_DAILY_CAP - alreadySent);
    const overQuota = emailTargets.length > remaining;

    if (dryRun) {
      return Response.json({
        dryRun: true,
        members: members.length,
        candidates: candidates.length,
        emailRecipients: emailTargets.length,
        emailsSentToday: alreadySent,
        dailyCap: EMAIL_DAILY_CAP,
        remaining,
        overQuota,
        migrationPending,
        poles: await listPoles(),
      });
    }

    if (migrationPending) return migrationRequired();

    if (!title || !body) {
      return Response.json(
        { error: "Titre et message sont obligatoires." },
        { status: 400 },
      );
    }
    if (members.length === 0 && candidates.length === 0) {
      return Response.json(
        { error: "Aucun destinataire ne correspond à cette sélection." },
        { status: 400 },
      );
    }
    // Le quota se vérifie AVANT toute écriture : mieux vaut refuser l'annonce
    // entière que la publier in-app avec des emails à moitié partis.
    if (sendEmail && overQuota) {
      return Response.json(
        {
          error:
            `${emailTargets.length} emails demandés, mais il ne reste que ` +
            `${remaining} envoi(s) sur le quota du jour (${alreadySent}/${EMAIL_DAILY_CAP} déjà utilisés). ` +
            "Décoche l'email, réduis l'audience, ou attends demain.",
        },
        { status: 400 },
      );
    }

    const senderName =
      [payload.email?.split("@")[0]].filter(Boolean).join(" ") || "Admin";

    const { data: announcement, error: insertErr } = await supabaseAdmin
      .from("announcements")
      .insert({
        title,
        body,
        target_members: targetMembers,
        member_pole: memberPole,
        target_candidates: targetCandidates,
        candidate_filter: targetCandidates ? candidateFilter : null,
        members_count: members.length,
        candidates_count: candidates.length,
        email_requested: sendEmail,
        created_by: payload.id,
        created_by_name: senderName,
      })
      .select("id")
      .single();
    if (insertErr) throw insertErr;

    // Notifications in-app — l'annonce existe même si un email échoue.
    if (members.length > 0) {
      const { error } = await supabaseAdmin.from("notifications").insert(
        members.map((m) => ({
          member_id: m.id,
          type: "annonce",
          title,
          body,
          announcement_id: announcement.id,
        })),
      );
      if (error) throw error;
    }
    if (candidates.length > 0) {
      const { error } = await supabaseAdmin.from("candidate_notifications").insert(
        candidates.map((c) => ({
          candidate_id: c.id,
          type: "annonce",
          title,
          body,
          announcement_id: announcement.id,
        })),
      );
      if (error) throw error;
    }

    let sent = 0;
    let failed = 0;
    if (sendEmail && emailTargets.length > 0) {
      const result = await sendAnnouncementEmails(emailTargets, title, body);
      sent = result.sent;
      failed = result.failed;
      const { error } = await supabaseAdmin
        .from("announcements")
        .update({ email_sent: sent, email_failed: failed })
        .eq("id", announcement.id);
      if (error) console.error("Announcements: maj compteur email", error);
    }

    return Response.json({
      ok: true,
      id: announcement.id,
      members: members.length,
      candidates: candidates.length,
      emailSent: sent,
      emailFailed: failed,
    });
  } catch (error) {
    if (isMissingTable(error)) return migrationRequired();
    console.error("Announcements POST error:", error);
    return Response.json(
      { error: "Échec de l'envoi de l'annonce" },
      { status: 500 },
    );
  }
}
