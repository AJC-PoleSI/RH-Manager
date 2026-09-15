/**
 * slot-links — Le lien attaché à un créneau de business game.
 *
 * L'admin dépose sur chaque créneau de BG un lien (sujet de l'épreuve, dossier
 * partagé, grille de notes…). Ce lien est réservé aux examinateurs affectés à
 * CE créneau : ni les candidats, ni les examinateurs des autres groupes.
 *
 * COMMENT L'ÉTANCHÉITÉ EST OBTENUE
 * ────────────────────────────────
 * Elle ne repose sur aucun contrôle écrit ici. Le lien vit dans sa propre
 * table (`slot_links`), donc aucun `select("*")` sur `evaluation_slots` ne le
 * ramasse — ni /api/slots/all (ouverte à tout le staff), ni une route écrite
 * demain. Côté lecture, il n'est greffé que sur les réponses qui partent déjà
 * de `slot_member_assignments.member_id = <moi>` (/slots/my-slots,
 * /evaluations/next-candidates) : le périmètre d'accès est celui, déjà
 * éprouvé, des affectations.
 *
 * MODULE PUR : il est importé par des composants client (planning,
 * évaluations) pour afficher un lien. Les lectures en base vivent dans
 * `slot-links-db.ts`, pour que ni le client Supabase ni la clé service_role
 * ne se retrouvent dans le bundle navigateur.
 */

/** Ce qu'une route renvoie au client. Jamais l'auteur ni la ligne brute. */
export interface SlotLink {
  url: string;
  label: string | null;
  updatedAt: string | null;
}

/**
 * 2000 caractères : limite usuelle des navigateurs pour une URL. Au-delà, le
 * lien serait de toute façon inexploitable — autant le refuser à la saisie.
 */
export const MAX_SLOT_LINK_URL = 2000;

/** Un libellé est un repère court dans l'interface, pas une description. */
export const MAX_SLOT_LINK_LABEL = 80;

export type SlotLinkError =
  | "missing"
  | "not_a_url"
  | "unsupported_scheme"
  | "too_long";

/** L'entrée porte-t-elle déjà un schéma (`https:`, `javascript:`…) ? */
const HAS_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Valide et normalise l'URL saisie par l'admin.
 *
 * DEUX PIÈGES DISTINCTS :
 *
 * 1. Le collage sans schéma — « docs.google.com/… » est ce qu'on obtient en
 *    copiant depuis la barre d'adresse de Chrome. Sans préfixe, le navigateur
 *    traiterait `href` comme un chemin RELATIF et enverrait l'examinateur sur
 *    /dashboard/docs.google.com. On préfixe donc `https://`.
 *
 * 2. Le schéma dangereux — `javascript:…` dans un `href` s'exécute dans la
 *    session de l'examinateur au moindre clic. Seuls http et https passent ;
 *    c'est un filtre serveur, pas un filtre d'affichage, pour que la base ne
 *    contienne jamais une telle valeur.
 */
export function normalizeSlotLinkUrl(
  raw: unknown,
): { ok: true; url: string } | { ok: false; error: SlotLinkError } {
  if (typeof raw !== "string") return { ok: false, error: "missing" };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, error: "missing" };
  if (trimmed.length > MAX_SLOT_LINK_URL)
    return { ok: false, error: "too_long" };

  const candidate = HAS_SCHEME_RE.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: "not_a_url" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "unsupported_scheme" };
  }
  if (!parsed.hostname) return { ok: false, error: "not_a_url" };

  return { ok: true, url: parsed.toString() };
}

/** Message rendu à l'admin : il doit dire quoi corriger, pas « invalide ». */
export function slotLinkErrorMessage(error: SlotLinkError): string {
  switch (error) {
    case "missing":
      return "Indiquez un lien.";
    case "not_a_url":
      return "Ce n'est pas une adresse valide (ex. https://drive.google.com/…).";
    case "unsupported_scheme":
      return "Seuls les liens http:// et https:// sont acceptés.";
    case "too_long":
      return `Lien trop long (${MAX_SLOT_LINK_URL} caractères maximum).`;
  }
}

/** Libellé facultatif, tronqué : vide et absent sont la même chose. */
export function normalizeSlotLinkLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, MAX_SLOT_LINK_LABEL);
}

/**
 * Nom d'hôte affichable (« drive.google.com »), à défaut de libellé.
 *
 * Une URL de partage Google fait 120 caractères illisibles : l'examinateur a
 * besoin de reconnaître la destination d'un coup d'œil, pas de la lire.
 */
export function slotLinkHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
