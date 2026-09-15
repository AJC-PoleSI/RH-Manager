import { supabaseAdmin, isMissingTableError } from "@/lib/supabase";

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

export type SlotLinkError = "missing" | "not_a_url" | "unsupported_scheme" | "too_long";

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
  if (trimmed.length > MAX_SLOT_LINK_URL) return { ok: false, error: "too_long" };

  const candidate = HAS_SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`;

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

/** Ligne telle qu'elle sort de la base. */
interface SlotLinkRow {
  slot_id: string;
  url: string;
  label: string | null;
  updated_at: string | null;
}

function toSlotLink(row: SlotLinkRow): SlotLink {
  return {
    url: row.url,
    label: row.label ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

/**
 * Par paquets de 200 identifiants : un `.in()` se traduit par une liste dans
 * l'URL de la requête, et 1000 UUID la feraient dépasser la limite de taille
 * de PostgREST. Chaque paquet reste aussi loin du plafond de 1000 lignes qui
 * tronque silencieusement les lectures (cf. lib/supabase-paging.ts).
 */
const ID_CHUNK = 200;

/**
 * Liens des créneaux demandés, indexés par `slot_id`.
 *
 * FAIL-SOFT ASSUMÉ : les migrations de ce projet s'appliquent à la main. Entre
 * le déploiement et l'exécution du SQL, `slot_links` n'existe pas. Un planning
 * d'examinateur qui renverrait 500 pour un lien absent serait une régression
 * bien plus grave que l'absence du lien lui-même : on renvoie une map vide.
 */
export async function fetchSlotLinks(
  slotIds: string[],
): Promise<Map<string, SlotLink>> {
  const ids = Array.from(new Set(slotIds.filter(Boolean)));
  const links = new Map<string, SlotLink>();
  if (ids.length === 0) return links;

  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const { data, error } = await supabaseAdmin
      .from("slot_links")
      .select("slot_id, url, label, updated_at")
      .in("slot_id", chunk);

    if (error) {
      if (!isMissingTableError(error)) {
        console.error("fetchSlotLinks error:", error);
      }
      return links;
    }

    for (const row of (data || []) as SlotLinkRow[]) {
      links.set(row.slot_id, toSlotLink(row));
    }
  }

  return links;
}

/**
 * Greffe le lien sur des objets déjà filtrés aux créneaux du membre.
 *
 * L'appelant garantit ce périmètre ; cette fonction ne le vérifie pas — elle
 * n'a pas de quoi le faire. Elle n'est donc à utiliser que sur des réponses
 * construites à partir des affectations du demandeur.
 */
export async function attachSlotLinks<T extends Record<string, unknown>>(
  rows: T[],
  slotIdOf: (row: T) => string | null | undefined,
  key = "link",
): Promise<T[]> {
  const links = await fetchSlotLinks(
    rows.map((r) => slotIdOf(r)).filter((id): id is string => !!id),
  );
  if (links.size === 0) return rows.map((r) => ({ ...r, [key]: null }));

  return rows.map((row) => {
    const id = slotIdOf(row);
    return { ...row, [key]: (id && links.get(id)) || null };
  });
}
