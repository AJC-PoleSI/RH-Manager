// availability-coverage — les examinateurs ont-ils saisi leurs dispos pour
// ce tour ?
//
// C'est la PUBLICATION qui fige les jurys (cf. slot-lock.ts) : publier trop
// tôt donne tout à ceux qui ont rempli leurs dispos en premier, et ceux qui
// arrivent après ne sont plus placés que sur les créneaux restés libres.
// Décision de Felix (25/09/2026) : AVERTIR au moment de publier, sans
// bloquer — c'est lui qui tranche.
//
// Fonctions pures (tests dans availability-coverage.test.ts).

export interface CoverageMember {
  id: string;
  name: string;
}

export interface CoverageInput {
  members: CoverageMember[];
  /** Une ligne par dispo : membre + jour ("YYYY-MM-DD" ou horodatage ISO). */
  availabilities: Array<{ member_id: string | null; date: string | null }>;
  /**
   * Membres qui ont déjà pris part au recrutement (une dispo ou une
   * affectation, tous tours confondus). Les autres — compte de secrétariat,
   * membre jamais mobilisé — ne sont pas attendus.
   */
  participantIds: Set<string>;
  /** Jours du tour, bornes incluses, au format "YYYY-MM-DD". */
  range: { from: string; to: string };
}

export interface CoverageResult {
  /** Examinateurs attendus (ayant déjà participé). */
  expected: number;
  /** Parmi eux, ceux qui ont au moins une dispo sur les jours du tour. */
  declared: number;
  /** Examinateurs attendus sans aucune dispo sur le tour, par ordre alphabétique. */
  missing: string[];
  /** Membres jamais mobilisés, non comptés (affichés à part). */
  neverParticipated: string[];
}

const ymd = (v: string | null | undefined) => String(v || "").substring(0, 10);

export function availabilityCoverage(input: CoverageInput): CoverageResult {
  const { from, to } = input.range;
  const withDispo = new Set<string>();
  for (const av of input.availabilities) {
    const day = ymd(av.date);
    if (av.member_id && day >= from && day <= to) withDispo.add(av.member_id);
  }

  const byName = (a: CoverageMember, b: CoverageMember) =>
    a.name.localeCompare(b.name, "fr");
  const expected = input.members.filter((m) => input.participantIds.has(m.id));
  const missing = expected.filter((m) => !withDispo.has(m.id)).sort(byName);

  return {
    expected: expected.length,
    declared: expected.length - missing.length,
    missing: missing.map((m) => m.name),
    neverParticipated: input.members
      .filter((m) => !input.participantIds.has(m.id))
      .sort(byName)
      .map((m) => m.name),
  };
}

/**
 * Texte de la confirmation affichée avant de publier, ou `null` quand tous
 * les examinateurs attendus ont saisi des dispos.
 */
export function coverageWarning(
  result: CoverageResult,
  tourLabel: string,
): string | null {
  if (result.expected === 0 || result.missing.length === 0) return null;

  const pct = Math.round((100 * result.declared) / result.expected);
  const jamais =
    result.neverParticipated.length > 0
      ? `\n(Jamais mobilisés, non comptés : ${result.neverParticipated.join(", ")}.)`
      : "";

  return (
    `Dispos saisies pour ${tourLabel} : ${result.declared} examinateurs sur ${result.expected} (${pct} %).\n\n` +
    `Pas encore de dispo : ${result.missing.join(", ")}.${jamais}\n\n` +
    `Publier fige les jurys : ceux qui saisiront leurs dispos après ne seront ` +
    `placés que sur les créneaux restés libres.\n\nPublier quand même ?`
  );
}
