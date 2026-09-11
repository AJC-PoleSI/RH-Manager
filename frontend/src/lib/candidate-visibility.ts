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
  viewerId?: string | null,
): Record<string, any> {
  if (isAdmin) return candidate;
  if (!candidate) return candidate;

  const projected: Record<string, any> = {};
  for (const field of MEMBER_VISIBLE_FIELDS) {
    if (field in candidate) projected[field] = candidate[field];
  }

  // Les évaluations restent visibles : elles portent les notes et l'identité
  // de l'examinateur. Le COMMENTAIRE, lui, n'est visible que par son auteur —
  // même règle que /api/evaluations/candidate/[id] et /api/deliberations
  // (audit du 12/09/2026 : ces deux routes le masquaient, celles des candidats
  // le laissaient passer en clair à tout membre).
  const projectEvaluation = (ev: Record<string, any>) =>
    ev && typeof ev === "object"
      ? {
          ...ev,
          comment:
            viewerId && ev.member_id === viewerId ? ev.comment : null,
        }
      : ev;
  if ("candidate_evaluations" in candidate) {
    const raw = candidate.candidate_evaluations;
    projected.candidate_evaluations = Array.isArray(raw)
      ? raw.map(projectEvaluation)
      : raw;
  }
  if ("evaluations" in candidate) {
    const raw = candidate.evaluations;
    projected.evaluations = Array.isArray(raw) ? raw.map(projectEvaluation) : raw;
  }
  if ("candidate_wishes" in candidate) {
    projected.candidate_wishes = candidate.candidate_wishes;
  }
  // Délibérations : on ne laisse passer que les STATUTS de tour, jamais les
  // champs de commentaire (pros/cons/global), réservés aux admins.
  //
  // Audit du 07/09/2026 : ce bloc recopiait l'objet `deliberations` entier.
  // Aucun appelant ne le sélectionne aujourd'hui, donc rien ne fuitait — mais
  // il aurait suffi qu'un développeur ajoute `deliberations(*)` à un `select()`
  // pour que les commentaires de délibération partent vers tout membre, sans
  // qu'aucun test ne le voie. La projection est désormais sûre par construction.
  if ("deliberations" in candidate) {
    const raw = candidate.deliberations;
    const projectDelib = (d: Record<string, any> | null) =>
      d
        ? {
            tour1_status: d.tour1_status ?? null,
            tour2_status: d.tour2_status ?? null,
            tour3_status: d.tour3_status ?? null,
          }
        : d;
    projected.deliberations = Array.isArray(raw)
      ? raw.map(projectDelib)
      : projectDelib(raw);
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
