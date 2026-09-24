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
