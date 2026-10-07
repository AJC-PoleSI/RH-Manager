// Liste des salles de l'onglet « Création » du planning.
//
// Elle vit dans system_settings sous la clé `rooms`, en texte séparé par des
// virgules (format historique, lu tel quel par la grille des ouvertures).
// Tant que personne ne l'a enregistrée, on retombe sur les salles utilisées
// depuis le premier tour. Module pur : partagé par l'API et ses tests.

export const DEFAULT_ROOMS = ["205", "217", "219", "235", "238-240", "242-244"];

export const ROOM_NAME_MAX = 40;

/** Lit la valeur stockée ; vide ou absente → null (liste jamais enregistrée). */
export function parseRoomList(value: string | null | undefined): string[] | null {
  const list = String(value ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  return list.length ? Array.from(new Set(list)) : null;
}

export function serializeRoomList(rooms: string[]): string {
  return rooms.join(",");
}

/** Motif de refus d'un nom de salle, ou null s'il est valable. */
export function validateRoomName(name: unknown): string | null {
  const n = typeof name === "string" ? name.trim() : "";
  if (!n) return "Le nom de la salle est vide.";
  if (n.includes(",")) return "Le nom d'une salle ne peut pas contenir de virgule.";
  if (n.length > ROOM_NAME_MAX)
    return `Le nom d'une salle ne dépasse pas ${ROOM_NAME_MAX} caractères.`;
  return null;
}

/**
 * Valide une liste envoyée par le client : noms nettoyés, sans doublon (à la
 * casse près : « a12 » et « A12 » désigneraient la même porte).
 */
export function normalizeRoomList(
  input: unknown,
): { rooms: string[] } | { error: string } {
  if (!Array.isArray(input)) return { error: "Liste de salles invalide." };
  const rooms: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const err = validateRoomName(raw);
    if (err) return { error: err };
    const name = String(raw).trim();
    const key = name.toLowerCase();
    if (seen.has(key)) return { error: `La salle « ${name} » apparaît deux fois.` };
    seen.add(key);
    rooms.push(name);
  }
  if (rooms.length === 0) return { error: "Il faut au moins une salle." };
  return { rooms };
}

/** Remplace `from` par `to` à la même place ; ajoute `to` si `from` n'y est pas. */
export function renameInList(rooms: string[], from: string, to: string): string[] {
  return rooms.includes(from)
    ? rooms.map((r) => (r === from ? to : r))
    : [...rooms, to];
}

// ── Créneaux « sans salle » (Tour 3, 07/10/2026) ──────────────────────────
// Décision de Felix : les entretiens RH et SI se tiennent sans salle
// réservée — les examinateurs en trouvent une et préviennent le candidat.
// Ces créneaux portent une salle fictive « Sans salle (RH) », « Sans salle
// (SI) » : une ouverture exige un nom de salle, et un nom par épreuve évite
// que deux épreuves sans salle se bloquent mutuellement au même horaire.

export const NO_ROOM_PREFIX = "Sans salle";

/** Bandeau des examinateurs sur un créneau sans salle. */
export const NO_ROOM_EXAMINER_NOTICE =
  "Pas de salle réservée : trouvez une salle et prévenez le candidat.";

/** Ce qu'un candidat lit à la place de la salle fictive. */
export const NO_ROOM_CANDIDATE_LABEL = "Salle communiquée par le jury";

/** Salle fictive d'un créneau sans salle réservée ? */
export function isNoRoom(room: string | null | undefined): boolean {
  return String(room ?? "")
    .trim()
    .toLowerCase()
    .startsWith(NO_ROOM_PREFIX.toLowerCase());
}

/** Salle telle qu'un candidat la voit (null / vide inchangés). */
export function roomForCandidate(room: string | null | undefined): string | null {
  if (!room) return room ?? null;
  return isNoRoom(room) ? NO_ROOM_CANDIDATE_LABEL : room;
}
