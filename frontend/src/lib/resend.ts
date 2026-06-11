import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.RESEND_FROM_EMAIL ?? "noreply@audencia-junior-conseil.com";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// Email de résultat de délibération (admis / refusé), avec un message
// libre rédigé par l'équipe recrutement (identique pour tous ou
// individualisé). `admis` pilote le ton et le sujet.
export async function sendResultEmail(
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
          <p style="margin:0 0 16px;font-size:16px;color:#111827;font-weight:600;">Bonjour ${firstName},</p>
          <div style="margin:0 0 8px;font-size:15px;color:#4b5563;line-height:1.6;">${safeMessage || (admis ? "Nous avons le plaisir de vous informer que votre candidature est retenue pour la suite du processus." : "Nous vous remercions pour votre candidature. Nous ne pourrons malheureusement pas y donner suite.")}</div>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">© ${new Date().getFullYear()} Audencia Junior Conseil — Cet email a été envoyé automatiquement.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`.trim();

  return resend.emails.send({ from: FROM, to: email, subject, html });
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
              <p style="margin:0 0 16px;font-size:16px;color:#111827;font-weight:600;">Bonjour ${firstName},</p>
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

  return resend.emails.send({
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
  const planningUrl = `${APP_URL}/dashboard/planning`;

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
              <p style="margin:0 0 16px;font-size:16px;color:#111827;font-weight:600;">Bonjour ${firstName},</p>
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

  return resend.emails.send({
    from: FROM,
    to: email,
    subject: `Tour 3 — ${candidatsCount} candidat${candidatsCount > 1 ? "s" : ""} à faire passer pour le pôle ${pole}`,
    html,
  });
}
