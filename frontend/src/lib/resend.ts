import { Resend } from "resend";
import { escapeHtml } from "./html";
import { chunk, EMAIL_BATCH_SIZE } from "./announcements";
import { DEFAULT_REFUSAL_MESSAGE } from "./elimination";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.RESEND_FROM_EMAIL ?? "noreply@audencia-junior-conseil.com";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const RESULT_EMAIL_LOT_SIZE = 10;

type Mail = { from: string; to: string; subject: string; html: string };

/**
 * Secours Brevo (offre gratuite : 300 mails/jour, même compte que Be Fast).
 *
 * Resend reste le canal principal ; Brevo ne prend le relais que quand
 * Resend refuse (quota de 100/jour atteint, limite de débit, panne). Le
 * 23/09/2026, 63 résultats de délibération sont partis en 429 sans aucun
 * filet. Sans BREVO_API_KEY / BREVO_FROM_EMAIL, le secours est inactif et
 * on retombe sur l'ancien comportement (échec remonté à l'appelant).
 */
async function sendViaBrevo(mail: Mail): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.BREVO_FROM_EMAIL;
  if (!apiKey || !from) {
    console.error("Brevo non configuré — pas de secours pour", mail.to);
    return false;
  }
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: { email: from, name: "Audencia Junior Conseil" },
        to: [{ email: mail.to }],
        subject: mail.subject,
        htmlContent: mail.html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("Brevo send error:", res.status, body, "→", mail.subject, mail.to);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Brevo send threw:", e, "→", mail.subject, mail.to);
    return false;
  }
}

// Le SDK Resend ne throw pas sur une erreur API (clé invalide, domaine non
// vérifié, etc.) — il renvoie `{ data: null, error }`. Sans cette vérification,
// un envoi qui échoue côté API est compté comme réussi par les appelants
// (ex: Promise.allSettled le voit "fulfilled"). En cas d'échec Resend, on
// tente Brevo ; on ne throw que si les deux ont échoué.
async function send(params: Mail) {
  const result = await resend.emails.send(params);
  if (!result.error) return { via: "resend" as const, error: null };
  console.error("Resend send error:", result.error, "→", params.subject, params.to);
  if (await sendViaBrevo(params)) return { via: "brevo" as const, error: null };
  throw new Error(`Resend: ${result.error.message || result.error.name}`);
}

/**
 * Envoie un lot via `resend.batch.send` (tout-ou-rien) ; si Resend refuse le
 * lot, chaque mail est retenté un par un via Brevo. Renvoie, pour chaque
 * mail du lot, s'il est parti.
 */
async function sendLot(lot: Mail[], label: string): Promise<boolean[]> {
  try {
    const result = await resend.batch.send(lot);
    if (result.error) throw new Error(result.error.message || result.error.name);
    return lot.map(() => true);
  } catch (e) {
    console.error(`${label} en échec côté Resend, secours Brevo —`, e);
    const ok: boolean[] = [];
    for (const mail of lot) ok.push(await sendViaBrevo(mail));
    return ok;
  }
}

/**
 * Envoi groupé des résultats de délibération.
 *
 * Même raison que `sendAnnouncementEmails` : un `Promise.all` de `send()`
 * individuels dépasse la limite de débit Resend et se fait jeter en 429 —
 * le 23/09/2026, 63 emails de résultat du tour 1 sur 73 sont partis en
 * erreur de cette façon. On passe par `resend.batch.send`, par lots de 10.
 *
 * Renvoie les `key` des envois en échec pour que l'appelant puisse relancer
 * uniquement ceux-là (sans renvoyer de doublon aux autres).
 */
export async function sendResultEmails<K>(
  items: {
    key: K;
    email: string;
    firstName: string;
    admis: boolean;
    tour: number;
    message: string;
  }[],
): Promise<{ sent: number; failedKeys: K[] }> {
  let sent = 0;
  const failedKeys: K[] = [];

  // Lots de 10 plutôt que 100 : un lot batch est tout-ou-rien côté Resend,
  // un rejet ne coûte donc que 10 emails (relançables) au lieu de tout l'envoi.
  // 600 ms entre deux lots → < 2 req/s, loin sous la limite Resend.
  const lots = chunk(items, RESULT_EMAIL_LOT_SIZE);
  for (let i = 0; i < lots.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 600));
    const lot = lots[i];
    const ok = await sendLot(
      lot.map((it) =>
        buildResultEmail(it.email, it.firstName, it.admis, it.tour, it.message),
      ),
      `sendResultEmails: lot ${i + 1}/${lots.length}`,
    );
    ok.forEach((good, j) => {
      if (good) sent++;
      else failedKeys.push(lot[j].key);
    });
  }

  return { sent, failedKeys };
}

// Email de résultat de délibération (admis / refusé), avec un message
// libre rédigé par l'équipe recrutement (identique pour tous ou
// individualisé). `admis` pilote le ton et le sujet.
function buildResultEmail(
  email: string,
  firstName: string,
  admis: boolean,
  tour: number,
  message: string,
) {
  const accent = admis ? "#16A34A" : "#E8446A";
  const titre = admis
    ? `Félicitations — vous passez au tour suivant`
    : `Résultat de votre candidature`;
  const subject = admis
    ? `Bonne nouvelle — Résultat du tour ${tour} · Audencia Junior Conseil`
    : `Résultat du tour ${tour} · Audencia Junior Conseil`;

  const safeMessage = (message || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:${accent};padding:32px 40px;text-align:center;">
          <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.85);letter-spacing:1px;text-transform:uppercase;">Audencia Junior Conseil</p>
          <h1 style="margin:8px 0 0;font-size:22px;font-weight:700;color:#ffffff;">${titre}</h1>
        </td></tr>
        <tr><td style="padding:36px 40px 28px;">
          <p style="margin:0 0 16px;font-size:16px;color:#111827;font-weight:600;">Bonjour ${escapeHtml(firstName)},</p>
          <div style="margin:0 0 8px;font-size:15px;color:#4b5563;line-height:1.6;">${safeMessage || (admis ? "Nous avons le plaisir de vous informer que votre candidature est retenue pour la suite du processus." : DEFAULT_REFUSAL_MESSAGE)}</div>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">© ${new Date().getFullYear()} Audencia Junior Conseil — Cet email a été envoyé automatiquement.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`.trim();

  return { from: FROM, to: email, subject, html };
}

export async function sendVerificationEmail(
  email: string,
  firstName: string,
  token: string,
) {
  const verificationUrl = `${APP_URL}/verify-email?token=${token}`;

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Vérifiez votre email</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#E8446A,#c0395a);padding:32px 40px;text-align:center;">
              <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.8);letter-spacing:1px;text-transform:uppercase;">Audencia Junior Conseil</p>
              <h1 style="margin:8px 0 0;font-size:24px;font-weight:700;color:#ffffff;">Plateforme de recrutement</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 16px;font-size:16px;color:#111827;font-weight:600;">Bonjour ${escapeHtml(firstName)},</p>
              <p style="margin:0 0 24px;font-size:15px;color:#4b5563;line-height:1.6;">
                Merci de vous être inscrit sur la plateforme de recrutement d'Audencia Junior Conseil.<br/>
                Pour accéder à votre espace candidat, veuillez vérifier votre adresse email en cliquant sur le bouton ci-dessous.
              </p>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
                <tr>
                  <td style="background:#E8446A;border-radius:8px;">
                    <a href="${verificationUrl}"
                       style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.3px;">
                      Vérifier mon email →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">
                Ce lien expire dans <strong>24 heures</strong>. Si vous n'avez pas créé de compte, ignorez cet email.
              </p>
              <p style="margin:0;font-size:12px;color:#9ca3af;word-break:break-all;">
                Lien : <a href="${verificationUrl}" style="color:#E8446A;">${verificationUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                © ${new Date().getFullYear()} Audencia Junior Conseil — Cet email a été envoyé automatiquement.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  return send({
    from: FROM,
    to: email,
    subject: "Vérifiez votre email — Audencia Junior Conseil",
    html,
  });
}

export async function sendResendVerificationEmail(
  email: string,
  firstName: string,
  token: string,
) {
  return sendVerificationEmail(email, firstName, token);
}

// Tour 3 : prévient un membre que des candidats doivent passer les
// épreuves de son pôle et qu'il doit s'inscrire sur des créneaux.
export async function sendPoleNotificationEmail(
  email: string,
  firstName: string,
  pole: string,
  candidatsCount: number,
  creneauxParMembre: number,
) {
  const planningUrl = `${APP_URL}/dashboard/availability`;

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tour 3 — Entretiens du pôle ${pole}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#2563eb,#1e40af);padding:32px 40px;text-align:center;">
              <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.8);letter-spacing:1px;text-transform:uppercase;">Audencia Junior Conseil</p>
              <h1 style="margin:8px 0 0;font-size:24px;font-weight:700;color:#ffffff;">Tour 3 — Pôle ${pole}</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 16px;font-size:16px;color:#111827;font-weight:600;">Bonjour ${escapeHtml(firstName)},</p>
              <p style="margin:0 0 16px;font-size:15px;color:#4b5563;line-height:1.6;">
                <strong>${candidatsCount} candidat${candidatsCount > 1 ? "s" : ""}</strong> ${candidatsCount > 1 ? "ont" : "a"} demandé le pôle <strong>${pole}</strong> et ${candidatsCount > 1 ? "doivent" : "doit"} passer les épreuves du pôle.
              </p>
              <p style="margin:0 0 24px;font-size:15px;color:#4b5563;line-height:1.6;">
                Chaque membre du pôle doit assurer au minimum <strong>${creneauxParMembre} créneau${creneauxParMembre > 1 ? "x" : ""}</strong> d'entretien. Inscrivez-vous dès maintenant sur les créneaux disponibles.
              </p>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
                <tr>
                  <td style="background:#2563eb;border-radius:8px;">
                    <a href="${planningUrl}"
                       style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.3px;">
                      Choisir mes créneaux →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:13px;color:#6b7280;">
                Vous recevez cet email car vous êtes membre du pôle ${pole} sur la plateforme de recrutement.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                © ${new Date().getFullYear()} Audencia Junior Conseil — Cet email a été envoyé automatiquement.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  return send({
    from: FROM,
    to: email,
    subject: `Tour 3 — ${candidatsCount} candidat${candidatsCount > 1 ? "s" : ""} à faire passer pour le pôle ${pole}`,
    html,
  });
}

/**
 * Lien de définition / réinitialisation de mot de passe (membres).
 *
 * `mode` change uniquement le ton :
 *   • "reset"  → l'utilisateur a cliqué sur « Mot de passe oublié ? »
 *   • "invite" → un admin lui demande de choisir son mot de passe
 */
export async function sendPasswordResetEmail(
  email: string,
  firstName: string,
  token: string,
  mode: "reset" | "invite" = "reset",
  ttlHours = 24,
) {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`;
  const isInvite = mode === "invite";

  const subject = isInvite
    ? "Choisissez votre mot de passe · AJC Recrutement"
    : "Réinitialisation de votre mot de passe · AJC Recrutement";
  const titre = isInvite
    ? "Choisissez votre mot de passe"
    : "Réinitialisation du mot de passe";
  const intro = isInvite
    ? "L'équipe recrutement vous invite à définir vous-même votre mot de passe pour accéder à la plateforme AJC Recrutement."
    : "Vous avez demandé à réinitialiser votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau.";
  const cta = isInvite ? "Définir mon mot de passe" : "Réinitialiser mon mot de passe";
  const outro = isInvite
    ? "Si vous n'attendiez pas cet email, ignorez-le : votre mot de passe actuel reste valable."
    : "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe actuel reste inchangé.";

  // Échappé : ce prénom vient d'une saisie libre (audit sécurité 07/09/2026).
  const safeName = escapeHtml((firstName || "").trim());

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${titre}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#2563EB;padding:32px 40px;text-align:center;">
          <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.85);letter-spacing:1px;text-transform:uppercase;">Audencia Junior Conseil</p>
          <h1 style="margin:8px 0 0;font-size:22px;font-weight:700;color:#ffffff;">${titre}</h1>
        </td></tr>
        <tr><td style="padding:36px 40px 12px;">
          <p style="margin:0 0 16px;font-size:16px;color:#111827;font-weight:600;">Bonjour${safeName ? " " + safeName : ""},</p>
          <p style="margin:0 0 24px;font-size:15px;color:#4b5563;line-height:1.6;">${intro}</p>
          <p style="margin:0 0 24px;text-align:center;">
            <a href="${resetUrl}" style="display:inline-block;background:#2563EB;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 28px;border-radius:8px;">${cta}</a>
          </p>
          <p style="margin:0 0 8px;font-size:13px;color:#6b7280;line-height:1.6;">Ce lien est valable ${ttlHours} heures et ne peut servir qu'une fois.</p>
          <p style="margin:0 0 20px;font-size:12px;color:#9ca3af;line-height:1.6;word-break:break-all;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br/>${resetUrl}</p>
          <p style="margin:0 0 8px;font-size:13px;color:#6b7280;line-height:1.6;">${outro}</p>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">© ${new Date().getFullYear()} Audencia Junior Conseil — Cet email a été envoyé automatiquement.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`.trim();

  return send({ from: FROM, to: email, subject, html });
}

// Demande de suppression de compte émise par un candidat. Rien n'est supprimé
// ici : l'email prévient l'administration, qui traite la demande à la main.
export async function sendAccountDeletionRequestEmail(opts: {
  to: string;
  candidateId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  motif: string | null;
}) {
  // Deux variantes : le sujet d'un email n'est pas du HTML, y placer une valeur
  // échappée afficherait « &amp; » dans la ligne d'objet.
  const rawFullName =
    `${opts.firstName ?? ""} ${opts.lastName ?? ""}`.trim() || opts.email;
  const fullName = escapeHtml(rawFullName);
  const recu = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });

  const lignes = [
    `<strong>Candidat :</strong> ${fullName}`,
    `<strong>Email :</strong> ${escapeHtml(opts.email)}`,
    `<strong>Identifiant :</strong> ${escapeHtml(opts.candidateId)}`,
    `<strong>Demande reçue le :</strong> ${escapeHtml(recu)}`,
  ];
  // Le motif est une saisie libre, souvent sur plusieurs lignes : sans cette
  // conversion, la mise en forme disparaît dans le HTML.
  if (opts.motif) {
    lignes.push(
      `<strong>Motif indiqué :</strong> ${escapeHtml(opts.motif).replace(/\n/g, "<br/>")}`,
    );
  }

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#E8446A;padding:32px 40px;text-align:center;">
          <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.85);letter-spacing:1px;text-transform:uppercase;">Audencia Junior Conseil</p>
          <h1 style="margin:8px 0 0;font-size:22px;font-weight:700;color:#ffffff;">Demande de suppression de compte</h1>
        </td></tr>
        <tr><td style="padding:36px 40px 28px;">
          <p style="margin:0 0 20px;font-size:15px;color:#4b5563;line-height:1.6;">
            Un candidat demande la suppression de son compte sur la plateforme de recrutement.
            La suppression doit être effectuée manuellement.
          </p>
          ${lignes.map((l) => `<p style="margin:0 0 8px;font-size:14px;color:#111827;">${l}</p>`).join("")}
        </td></tr>
        <tr><td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">© ${new Date().getFullYear()} Audencia Junior Conseil — Cet email a été envoyé automatiquement.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`.trim();

  return send({
    from: FROM,
    to: opts.to,
    subject: `Demande de suppression de compte — ${rawFullName}`,
    html,
  });
}

/**
 * Changement de salle — l'horaire ne change JAMAIS, seule la salle change.
 *
 * Deux origines : le regroupement des inscriptions éparpillées sur plusieurs
 * salles au même horaire, et le déplacement manuel d'un créneau par l'admin.
 *
 * `role` choisit à qui l'on parle : le candidat qui vient passer l'épreuve, ou
 * l'examinateur qui vient l'évaluer. Les deux doivent être prévenus — prévenir
 * les seuls candidats laisserait le jury dans l'ancienne salle.
 */
export async function sendRoomChangeEmail(opts: {
  to: string;
  firstName: string | null;
  epreuve: string;
  dateLabel: string;
  timeLabel: string;
  oldRoom: string | null;
  newRoom: string | null;
  role?: "candidate" | "member";
}) {
  const safeName = escapeHtml((opts.firstName || "").trim());
  const isMember = opts.role === "member";
  const intro = isMember
    ? `La salle de l'épreuve <strong>${escapeHtml(opts.epreuve)}</strong> que vous évaluez a changé.`
    : `La salle de votre <strong>${escapeHtml(opts.epreuve)}</strong> a changé.`;
  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#2563EB;padding:32px 40px;text-align:center;">
          <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.85);letter-spacing:1px;text-transform:uppercase;">Audencia Junior Conseil</p>
          <h1 style="margin:8px 0 0;font-size:22px;font-weight:700;color:#ffffff;">Changement de salle</h1>
        </td></tr>
        <tr><td style="padding:36px 40px 28px;">
          <p style="margin:0 0 16px;font-size:16px;color:#111827;font-weight:600;">Bonjour${safeName ? " " + safeName : ""},</p>
          <p style="margin:0 0 20px;font-size:15px;color:#4b5563;line-height:1.6;">
            ${intro}
            <strong>La date et l'heure restent identiques.</strong>
          </p>
          <table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;border:1px solid #e5e7eb;border-radius:8px;">
            <tr><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#6b7280;">Date</td>
                <td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;font-weight:600;">${escapeHtml(opts.dateLabel)}</td></tr>
            <tr><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#6b7280;">Heure</td>
                <td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;font-weight:600;">${escapeHtml(opts.timeLabel)}</td></tr>
            <tr><td style="padding:14px 18px;font-size:14px;color:#6b7280;">Nouvelle salle</td>
                <td style="padding:14px 18px;font-size:16px;color:#2563EB;font-weight:700;">${escapeHtml(opts.newRoom || "—")}</td></tr>
          </table>
          <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
            ${opts.oldRoom ? `L'ancienne salle était la ${escapeHtml(opts.oldRoom)}. ` : ""}Merci de vous rendre directement en salle ${escapeHtml(opts.newRoom || "—")}.
          </p>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">© ${new Date().getFullYear()} Audencia Junior Conseil — Cet email a été envoyé automatiquement.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`.trim();

  return send({
    from: FROM,
    to: opts.to,
    subject: `Changement de salle — ${opts.epreuve} du ${opts.dateLabel}`,
    html,
  });
}

/**
 * Envoi d'une ANNONCE GÉNÉRALE à une liste de destinataires.
 *
 * Passe par `resend.batch.send` (100 emails par requête) plutôt que par un
 * `Promise.all` de `send()` : Resend limite à 2 requêtes/seconde, donc un
 * envoi parallèle à 100 destinataires se fait jeter en 429 — sans erreur
 * visible pour l'admin, qui croit son annonce partie.
 *
 * Renvoie le détail (envoyés / en échec) au lieu de throw : une annonce
 * reste utile même si l'email échoue, la notification in-app, elle, est
 * déjà écrite en base.
 */
export async function sendAnnouncementEmails(
  recipients: { email: string; firstName?: string | null }[],
  title: string,
  message: string,
): Promise<{ sent: number; failed: number }> {
  if (recipients.length === 0) return { sent: 0, failed: 0 };

  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br/>");

  const payloads = recipients.map((r) => {
    const safeName = escapeHtml((r.firstName || "").trim());
    return {
      from: FROM,
      to: r.email,
      subject: `${title} · Audencia Junior Conseil`,
      html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#2563EB;padding:32px 40px;text-align:center;">
          <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.85);letter-spacing:1px;text-transform:uppercase;">Audencia Junior Conseil</p>
          <h1 style="margin:8px 0 0;font-size:22px;font-weight:700;color:#ffffff;">${safeTitle}</h1>
        </td></tr>
        <tr><td style="padding:36px 40px 28px;">
          <p style="margin:0 0 16px;font-size:16px;color:#111827;font-weight:600;">Bonjour${safeName ? " " + safeName : ""},</p>
          <div style="margin:0;font-size:15px;color:#4b5563;line-height:1.6;">${safeMessage}</div>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">© ${new Date().getFullYear()} Audencia Junior Conseil — Cet email a été envoyé automatiquement.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`.trim(),
    };
  });

  let sent = 0;
  let failed = 0;

  const lots = chunk(payloads, EMAIL_BATCH_SIZE);
  for (let i = 0; i < lots.length; i++) {
    // 600 ms entre deux lots : marge confortable sous les 2 req/s de Resend.
    if (i > 0) await new Promise((r) => setTimeout(r, 600));
    const ok = await sendLot(lots[i], `sendAnnouncementEmails: lot ${i + 1}/${lots.length}`);
    for (const good of ok) {
      if (good) sent++;
      else failed++;
    }
  }

  return { sent, failed };
}

/**
 * Doublon email d'un message privé envoyé depuis la messagerie.
 *
 * La messagerie in-app n'envoie aucune notification : un candidat qui ne se
 * reconnecte pas ne voit jamais le message. Cet email reprend le texte tel
 * quel et renvoie vers la messagerie — il ne remplace pas le message, il
 * le double.
 *
 * Ne throw pas : le message est déjà écrit en base quand on arrive ici, un
 * envoi raté ne doit pas faire échouer la conversation. L'appelant reçoit
 * `{ sent: false, error }` et l'affiche à l'admin.
 */
export async function sendDirectMessageEmail(opts: {
  to: string;
  firstName?: string | null;
  senderName: string;
  message: string;
  recipientRole: "candidate" | "member";
}): Promise<{ sent: boolean; error?: string }> {
  const safeName = escapeHtml((opts.firstName || "").trim());
  const safeSender = escapeHtml(opts.senderName.trim());
  const safeMessage = escapeHtml(opts.message).replace(/\n/g, "<br/>");
  // Les candidats et les membres n'ont pas la même messagerie.
  const messagesUrl =
    opts.recipientRole === "candidate"
      ? `${APP_URL}/candidates/messages`
      : `${APP_URL}/dashboard/messages`;

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#2563EB;padding:32px 40px;text-align:center;">
          <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.85);letter-spacing:1px;text-transform:uppercase;">Audencia Junior Conseil</p>
          <h1 style="margin:8px 0 0;font-size:22px;font-weight:700;color:#ffffff;">Nouveau message</h1>
        </td></tr>
        <tr><td style="padding:36px 40px 28px;">
          <p style="margin:0 0 16px;font-size:16px;color:#111827;font-weight:600;">Bonjour${safeName ? " " + safeName : ""},</p>
          <p style="margin:0 0 20px;font-size:15px;color:#4b5563;line-height:1.6;">
            Vous avez re&ccedil;u un message de <strong>${safeSender}</strong> sur la plateforme de recrutement :
          </p>
          <div style="margin:0 0 24px;padding:16px 18px;background:#f9fafb;border-left:3px solid #2563EB;border-radius:6px;font-size:15px;color:#111827;line-height:1.6;">${safeMessage}</div>
          <p style="margin:0 0 24px;text-align:center;">
            <a href="${messagesUrl}" style="display:inline-block;background:#2563EB;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 28px;border-radius:8px;">Voir la conversation</a>
          </p>
          <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
            R&eacute;pondez depuis la plateforme : cette adresse ne re&ccedil;oit pas les r&eacute;ponses.
          </p>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">© ${new Date().getFullYear()} Audencia Junior Conseil — Cet email a été envoyé automatiquement.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`.trim();

  try {
    await send({
      from: FROM,
      to: opts.to,
      subject: `Nouveau message de ${opts.senderName} · AJC Recrutement`,
      html,
    });
    return { sent: true };
  } catch (e) {
    console.error("sendDirectMessageEmail:", e);
    return { sent: false, error: e instanceof Error ? e.message : String(e) };
  }
}
