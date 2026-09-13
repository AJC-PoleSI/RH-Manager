/**
 * candidate-signup-status — ce qu'il reste à faire au candidat côté inscriptions.
 *
 * Logique PURE (aucune I/O), testée unitairement, alimentée par la seule
 * réponse de `/api/slots/available` : cette route est déjà filtrée pour le
 * candidat (épreuves publiées, jury au complet, tour visible, pôles demandés
 * au tour 3), donc tout ce qui en sort est réservable par LUI. Inutile de
 * recroiser la liste des épreuves : on aurait à redupliquer ces règles.
 *
 * Deux relances en découlent :
 *   • les épreuves pour lesquelles il n'a encore AUCUN créneau ;
 *   • les créneaux où il s'est inscrit SEUL et qui manquent encore de monde.
 */

/** Vue minimale d'un créneau tel que renvoyé par /api/slots/available. */
export interface SignupSlot {
  id: string;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  isFull?: boolean;
  isEnrolled?: boolean;
  /** Inscrits sur la session (salle) proposée, hors salles parallèles. */
  sessionEnrolled?: number;
  /** Minimum de candidats de la session — null hors épreuve de groupe. */
  minCandidates?: number | null;
  /** Candidats encore nécessaires pour atteindre ce minimum. */
  missingCandidates?: number;
  epreuve?: { id?: string; name?: string; tour?: number } | null;
}

/** Une épreuve pour laquelle le candidat n'a pas encore réservé de créneau. */
export interface PendingEpreuve {
  epreuveId: string;
  name: string;
  tour: number;
  /** Créneaux encore réservables pour cette épreuve. */
  freeSlots: number;
}

/**
 * Épreuves visibles pour lesquelles le candidat n'a AUCUNE inscription.
 *
 * `freeSlots` peut valoir 0 : l'épreuve reste à signaler (il lui manque bien
 * un créneau) mais plus rien n'est réservable — c'est à l'équipe recrutement
 * de rouvrir des places, et le message doit le dire autrement.
 */
export function pendingEpreuves(slots: SignupSlot[]): PendingEpreuve[] {
  const byEpreuve = new Map<
    string,
    { name: string; tour: number; enrolled: boolean; freeSlots: number }
  >();

  for (const slot of slots) {
    const id = slot.epreuve?.id;
    if (!id) continue;
    const entry = byEpreuve.get(id) || {
      name: slot.epreuve?.name || "Épreuve",
      tour: slot.epreuve?.tour ?? 0,
      enrolled: false,
      freeSlots: 0,
    };
    if (slot.isEnrolled) entry.enrolled = true;
    if (!slot.isFull && !slot.isEnrolled) entry.freeSlots += 1;
    byEpreuve.set(id, entry);
  }

  return Array.from(byEpreuve.entries())
    .filter(([, e]) => !e.enrolled)
    .map(([epreuveId, e]) => ({
      epreuveId,
      name: e.name,
      tour: e.tour,
      freeSlots: e.freeSlots,
    }))
    .sort((a, b) => a.tour - b.tour || a.name.localeCompare(b.name));
}

/** Un créneau réservé par le candidat, encore sous son minimum. */
export interface UnderfilledEnrollment {
  slotId: string;
  name: string;
  date: string | null;
  startTime: string | null;
  /** Inscrits sur la session, le candidat compris. */
  sessionEnrolled: number;
  missingCandidates: number;
  /** Le candidat y est le SEUL inscrit. */
  alone: boolean;
}

/**
 * Créneaux réservés par le candidat qui n'ont pas encore assez de monde.
 *
 * Ne concerne que les épreuves à minimum (groupe) : être seul sur un entretien
 * individuel est l'état normal, pas une alerte. Les prochains inscrits sur cet
 * horaire seront placés dans SA salle en priorité (cf. pickPackedRoom), d'où
 * l'intérêt de lui dire d'en parler autour de lui plutôt que de le laisser
 * croire que son créneau va sauter.
 */
export function underfilledEnrollments(
  slots: SignupSlot[],
): UnderfilledEnrollment[] {
  return slots
    .filter(
      (s) =>
        s.isEnrolled === true &&
        s.minCandidates != null &&
        (s.missingCandidates ?? 0) > 0,
    )
    .map((s) => ({
      slotId: s.id,
      name: s.epreuve?.name || "Épreuve",
      date: s.date ?? null,
      startTime: s.startTime ?? null,
      sessionEnrolled: s.sessionEnrolled ?? 0,
      missingCandidates: s.missingCandidates ?? 0,
      alone: (s.sessionEnrolled ?? 0) <= 1,
    }));
}
