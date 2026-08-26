// Ce qu'un membre non-admin a le droit de voir d'un candidat.
//
// Décision produit (26 août 2026) : un examinateur consulte « qui l'a examiné,
// les notes, son numéro au cas où et les commentaires — mais pas plus ».
// Auparavant, GET /api/candidates et GET /api/candidates/[id] faisaient un
// `select("*")` : n'importe quel membre du staff récupérait l'email, la date
// de naissance, le parcours scolaire, les jetons de vérification et les
// champs d'intégration Be Fast de TOUS les candidats du recrutement.
//
// Les admins ne passent pas par ici : ils voient la fiche complète.

/** Champs de `candidates` visibles par un membre non-admin. */
const MEMBER_VISIBLE_FIELDS = [
  "id",
  "first_name",
  "last_name",
  // « son numéro au cas où » : le jury doit pouvoir joindre un candidat en
  // retard ou absent le jour de l'épreuve.
  "phone",
  "created_at",
] as const;

/**
 * Ne conserve d'un candidat que les champs visibles par un membre non-admin,
 * en préservant les évaluations éventuellement jointes (notes, identité de
 * l'examinateur, commentaires) — c'est le cœur du travail de jury.
 *
 * `isAdmin` renvoie l'objet inchangé.
 */
export function projectCandidateForMember<T extends Record<string, any>>(
  candidate: T,
  isAdmin: boolean,
): Record<string, any> {
  if (isAdmin) return candidate;
  if (!candidate) return candidate;

  const projected: Record<string, any> = {};
  for (const field of MEMBER_VISIBLE_FIELDS) {
    if (field in candidate) projected[field] = candidate[field];
  }

  // Les évaluations restent visibles : elles portent les notes, le
  // commentaire et l'identité de l'examinateur.
  if ("candidate_evaluations" in candidate) {
    projected.candidate_evaluations = candidate.candidate_evaluations;
  }
  if ("evaluations" in candidate) {
    projected.evaluations = candidate.evaluations;
  }
  if ("candidate_wishes" in candidate) {
    projected.candidate_wishes = candidate.candidate_wishes;
  }
  if ("deliberations" in candidate) {
    projected.deliberations = candidate.deliberations;
  }

  return projected;
}

/**
 * Champs sur lesquels la recherche plein-texte peut porter. Chercher par email
 * en tant que non-admin transformerait la liste en oracle : « cet email
 * est-il candidat ? ». Les admins gardent la recherche par email.
 */
export function candidateSearchFields(isAdmin: boolean): string[] {
  return isAdmin
    ? ["first_name", "last_name", "email"]
    : ["first_name", "last_name"];
}
