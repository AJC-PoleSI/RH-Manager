/**
 * wishes-reminder-db — exécution de la relance « vœux de pôle non remplis ».
 *
 * Une seule fonction, `runWishesReminder`, appelée par trois chemins qui
 * doivent se comporter à l'identique : le cron Vercel du matin
 * (`GET /api/cron/wishes-reminder`), le bouton admin
 * (`POST /api/admin/wishes-reminder`) et l'aperçu de ce même bouton
 * (`dryRun`). La sélection est déléguée au module pur
 * `lib/wishes-reminder.ts` ; ici on ne fait que lire, envoyer, et tracer.
 */

import { supabaseAdmin } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/supabase-paging";
import { isMissingColumnError } from "@/lib/slot-lock";
import { getToursByNumber } from "@/lib/tour-status";
import { EMAIL_BATCH_SIZE, EMAIL_DAILY_CAP, chunk } from "@/lib/announcements";
import { emailsSentToday, isMissingTable } from "@/lib/announcements-db";
import { sendAnnouncementEmails } from "@/lib/resend";
import {
  selectCandidatesToRemind,
  WISHES_REMINDER_BODY,
  WISHES_REMINDER_SUBJECT,
  type ReminderCandidate,
  type ReminderDelib,
} from "@/lib/wishes-reminder";

export interface WishesReminderResult {
  dryRun: boolean;
  /**
   * La colonne `candidates.wishes_reminded_at` n'existe pas encore : rien
   * n'est parti. Sans elle, l'espacement de 3 jours est impossible à tenir
   * et le cron relancerait TOUT LE MONDE chaque matin.
   */
  migrationPending: boolean;
  /** Candidats à relancer (espacement compris), avant application du quota. */
  total: number;
  /** Ceux qui partent aujourd'hui, une fois le quota du jour appliqué. */
  toSend: number;
  /** Quota restant AVANT cet envoi. */
  remaining: number;
  emailsSentToday: number;
  dailyCap: number;
  sent: number;
  failed: number;
}

/** Même pause qu'entre deux lots dans lib/resend.ts : marge sous les 2 req/s. */
const PAUSE_BETWEEN_LOTS_MS = 600;

export async function runWishesReminder(opts: {
  dryRun: boolean;
}): Promise<WishesReminderResult> {
  const base: WishesReminderResult = {
    dryRun: opts.dryRun,
    migrationPending: false,
    total: 0,
    toSend: 0,
    remaining: 0,
    emailsSentToday: 0,
    dailyCap: EMAIL_DAILY_CAP,
    sent: 0,
    failed: 0,
  };

  // Toutes les lectures sont paginées : au-delà de 1000 lignes, PostgREST
  // tronque en silence et des candidats disparaîtraient de la relance sans
  // la moindre erreur (cf. lib/supabase-paging.ts).
  const [cands, delibs, wishes, tours] = await Promise.all([
    fetchAllRows<ReminderCandidate>((from, to) =>
      supabaseAdmin
        .from("candidates")
        .select(
          "id, email, first_name, email_verified, wishes_locked_at, wishes_reminded_at",
        )
        .order("id")
        .range(from, to),
    ),
    fetchAllRows<ReminderDelib>((from, to) =>
      supabaseAdmin
        .from("deliberations")
        .select("candidate_id, tour1_status, tour2_status, tour3_status")
        .order("candidate_id")
        .range(from, to),
    ),
    fetchAllRows<{ candidate_id: string }>((from, to) =>
      supabaseAdmin
        .from("candidate_wishes")
        .select("candidate_id")
        .order("id")
        .range(from, to),
    ),
    getToursByNumber(),
  ]);

  if (cands.error) {
    if (isMissingColumnError(cands.error)) {
      return { ...base, migrationPending: true };
    }
    throw cands.error;
  }
  if (delibs.error) throw delibs.error;
  if (wishes.error) throw wishes.error;

  // Quota partagé avec les annonces manuelles : le compteur ne connaît que
  // la table `announcements`, d'où la ligne « Relance automatique » insérée
  // plus bas après chaque envoi réel.
  const sentToday = (await emailsSentToday()) ?? 0;
  const remaining = Math.max(0, EMAIL_DAILY_CAP - sentToday);

  const due = selectCandidatesToRemind({
    candidates: cands.data || [],
    deliberations: delibs.data || [],
    wishCandidateIds: (wishes.data || []).map((w) => w.candidate_id),
    tour2Status: tours[2]?.status,
  });
  // Les non servis le seront les jours suivants : mieux vaut un envoi partiel
  // que des 429 Resend silencieux au-delà du plafond.
  const batch = due.slice(0, remaining);

  const result: WishesReminderResult = {
    ...base,
    total: due.length,
    toSend: batch.length,
    remaining,
    emailsSentToday: sentToday,
  };
  if (opts.dryRun || batch.length === 0) return result;

  let sent = 0;
  let failed = 0;
  const lots = chunk(batch, EMAIL_BATCH_SIZE);
  for (let i = 0; i < lots.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_LOTS_MS));
    const lot = lots[i];
    const r = await sendAnnouncementEmails(
      lot.map((c) => ({ email: c.email as string, firstName: c.first_name })),
      WISHES_REMINDER_SUBJECT,
      WISHES_REMINDER_BODY,
    );
    sent += r.sent;
    failed += r.failed;

    // `sendAnnouncementEmails` ne rend que des compteurs, pas le détail par
    // destinataire. On ne peut donc marquer « relancé » qu'un lot parti EN
    // ENTIER : sur un lot partiellement en échec, personne n'est marqué et
    // tout le lot repasse au prochain run — un doublon pour quelques-uns
    // vaut mieux qu'un candidat jamais relancé parce que marqué à tort.
    if (r.failed > 0) {
      console.error(
        `[wishes-reminder] lot ${i + 1}/${lots.length} : ${r.failed} échec(s) sur ${lot.length} — ` +
          "aucun candidat du lot marqué comme relancé.",
      );
      continue;
    }
    await markReminded(lot);
  }

  // Trace dans `announcements` pour que `emailsSentToday()` compte ces mails
  // dans le quota du jour et que l'historique du composeur les montre.
  const { error: annErr } = await supabaseAdmin.from("announcements").insert({
    title: WISHES_REMINDER_SUBJECT,
    body: WISHES_REMINDER_BODY,
    target_members: false,
    target_candidates: true,
    candidate_filter: "no_wishes",
    members_count: 0,
    candidates_count: batch.length,
    email_requested: true,
    email_sent: sent,
    email_failed: failed,
    created_by: null,
    created_by_name: "Relance automatique",
  });
  if (annErr) {
    // Les mails sont partis : on ne peut plus échouer, seulement prévenir.
    console.error(
      isMissingTable(annErr)
        ? "[wishes-reminder] table announcements absente — ces envois n'entrent pas dans le quota du jour"
        : "[wishes-reminder] trace dans announcements échouée",
      annErr,
    );
  }

  return { ...result, sent, failed };
}

/**
 * Horodate la relance et dépose la notification in-app, pour un lot dont
 * TOUS les mails sont partis. Les erreurs sont loguées, pas relancées : les
 * mails sont déjà envoyés, l'appelant doit continuer avec les lots suivants.
 */
async function markReminded(lot: ReminderCandidate[]): Promise<void> {
  const ids = lot.map((c) => c.id);

  const { error: updErr } = await supabaseAdmin
    .from("candidates")
    .update({ wishes_reminded_at: new Date().toISOString() })
    .in("id", ids);
  if (updErr) {
    console.error(
      "[wishes-reminder] wishes_reminded_at non mis à jour — ces candidats seront relancés au prochain run",
      updErr,
    );
  }

  const { error: notifErr } = await supabaseAdmin
    .from("candidate_notifications")
    .insert(
      ids.map((candidate_id) => ({
        candidate_id,
        type: "voeux_rappel",
        title: WISHES_REMINDER_SUBJECT,
        body: WISHES_REMINDER_BODY,
        link: "/candidates/wishes",
      })),
    );
  if (notifErr) {
    console.error("[wishes-reminder] notifications in-app non écrites", notifErr);
  }
}
