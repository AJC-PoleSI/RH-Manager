/**
 * Épreuves en distanciel — règles pures (sans base), partagées par les
 * routes d'inscription et l'accès à la notation.
 *
 * Une épreuve en distanciel n'a PAS de créneau : le candidat s'inscrit sur
 * l'application, les documents lui sont envoyés hors application, et
 * l'inscription sert surtout à savoir qui la passe. Décision de Felix le
 * 06/10/2026, premier cas : l'entretien de pôle Marketing du Tour 3.
 *
 * Migration : supabase-migration-epreuves-distanciel.sql.
 */
import { samePole } from "@/lib/auth-poles";

export type RegistrationAction = "register" | "unregister";

export interface RegistrationContext {
  action: RegistrationAction;
  isDistanciel: boolean;
  /** Statut du tour de l'épreuve : "a_venir" | "en_cours" | "termine". */
  tourStatus: string | null | undefined;
  /** Réglage global `planning_visible_candidats`. */
  planningVisible: boolean;
  /** `epreuves.inscription_deadline` (ISO), facultative. */
  deadline: string | null | undefined;
  now: Date;
}

function formatParis(d: Date): string {
  return d.toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
}

/**
 * Raison (en français, montrée au candidat) pour laquelle l'inscription ou la
 * désinscription est refusée, ou null si elle est permise.
 *
 * L'élimination du candidat est vérifiée à part par l'appelant (réponse
 * commune `eliminatedResponse`), comme pour les créneaux.
 */
export function registrationBlockReason(ctx: RegistrationContext): string | null {
  if (!ctx.isDistanciel) {
    return "Cette épreuve se passe sur un créneau : inscris-toi depuis le calendrier.";
  }
  if (ctx.tourStatus === "a_venir") {
    return "Ce tour n'a pas encore commencé.";
  }
  if (ctx.tourStatus === "termine") {
    return "Ce tour est terminé : les inscriptions sont closes.";
  }
  if (!ctx.planningVisible) {
    return "Les inscriptions ne sont pas encore ouvertes.";
  }
  if (ctx.deadline) {
    const deadline = new Date(ctx.deadline);
    // Une deadline illisible ne doit pas bloquer tout le monde.
    if (!Number.isNaN(deadline.getTime()) && ctx.now > deadline) {
      return ctx.action === "register"
        ? `Les inscriptions pour cette épreuve sont fermées depuis le ${formatParis(deadline)}.`
        : `La désinscription n'est plus possible depuis le ${formatParis(deadline)}.`;
    }
  }
  return null;
}

/**
 * Un membre (non admin) peut-il noter ce candidat sur cette épreuve en
 * distanciel ? Oui s'il est du pôle de l'épreuve et que le candidat s'y est
 * inscrit. Une épreuve distancielle hors pôle n'est notée que par les admins
 * (qui passent avant cette règle). Décision de Felix, 06/10/2026.
 */
export function canGradeDistanciel(o: {
  isDistanciel: boolean;
  isPoleTest: boolean;
  pole: string | null | undefined;
  memberPole: string | null | undefined;
  registered: boolean;
}): boolean {
  if (!o.isDistanciel || !o.registered) return false;
  if (!o.isPoleTest || !o.pole) return false;
  return samePole(o.pole, o.memberPole);
}
