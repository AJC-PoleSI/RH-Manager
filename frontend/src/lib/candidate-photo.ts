// Photos des candidats : validation et décodage.
//
// Le trombinoscope du jury (organigramme + soirée délibération) repose sur une
// photo déposée par le candidat depuis son espace. Ce module centralise ce
// qu'on accepte de recevoir, parce qu'une image est un fichier arbitraire
// envoyé par un utilisateur non authentifié à l'échelle de l'organisation :
// c'est le seul endroit de l'application où un candidat téléverse du binaire.

/** Types acceptés. Pas de SVG : un SVG est un document, il peut porter du script. */
export const ALLOWED_PHOTO_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type PhotoMime = (typeof ALLOWED_PHOTO_MIME)[number];

/**
 * Plafond après redimensionnement navigateur (512 px, JPEG qualité 0.82 →
 * typiquement 30-60 Ko). 800 Ko laisse une marge confortable tout en gardant
 * la table `candidate_photos` de l'ordre de la dizaine de mégaoctets pour un
 * recrutement complet.
 */
export const MAX_PHOTO_BYTES = 800 * 1024;

/** Côté client : cible du redimensionnement avant envoi. */
export const PHOTO_TARGET_SIZE = 512;

export interface DecodedPhoto {
  mimeType: PhotoMime;
  /** Contenu base64, sans le préfixe `data:<mime>;base64,`. */
  base64: string;
  byteSize: number;
}

export type PhotoDecodeError =
  | "missing"
  | "malformed"
  | "unsupported_type"
  | "too_large";

const DATA_URL_RE = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i;

/**
 * Valide une data URL `data:image/jpeg;base64,...` reçue du navigateur.
 *
 * Renvoie une erreur typée plutôt qu'un booléen pour que la route puisse
 * rendre un message précis au candidat (« format non accepté » vs « trop
 * lourde » n'appellent pas la même action de sa part).
 */
export function decodePhotoDataUrl(
  dataUrl: unknown,
): { ok: true; photo: DecodedPhoto } | { ok: false; error: PhotoDecodeError } {
  if (typeof dataUrl !== "string" || dataUrl.length === 0) {
    return { ok: false, error: "missing" };
  }

  const match = DATA_URL_RE.exec(dataUrl.trim());
  if (!match) return { ok: false, error: "malformed" };

  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_PHOTO_MIME.includes(mimeType as PhotoMime)) {
    return { ok: false, error: "unsupported_type" };
  }

  const base64 = match[2].replace(/\s+/g, "");

  // Taille décodée sans allouer le buffer : 3 octets pour 4 caractères,
  // moins le padding. Évite de matérialiser 50 Mo en mémoire si quelqu'un
  // envoie une chaîne géante juste pour la faire rejeter.
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const byteSize = Math.floor((base64.length * 3) / 4) - padding;

  if (byteSize <= 0) return { ok: false, error: "malformed" };
  if (byteSize > MAX_PHOTO_BYTES) return { ok: false, error: "too_large" };

  // Contrôle réel du base64 : une chaîne acceptée par la regex peut avoir une
  // longueur invalide. On décode pour de bon maintenant que la taille est
  // bornée.
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    return { ok: false, error: "malformed" };
  }
  if (buffer.byteLength === 0) return { ok: false, error: "malformed" };

  // Le type déclaré doit correspondre aux octets : sans ça, un candidat peut
  // annoncer `image/png` pour faire servir n'importe quoi par la route GET.
  if (!magicNumberMatches(buffer, mimeType as PhotoMime)) {
    return { ok: false, error: "unsupported_type" };
  }

  return {
    ok: true,
    photo: { mimeType: mimeType as PhotoMime, base64, byteSize: buffer.byteLength },
  };
}

/** Signature binaire du format, vérifiée contre le type MIME annoncé. */
function magicNumberMatches(buf: Buffer, mime: PhotoMime): boolean {
  if (buf.byteLength < 12) return false;
  switch (mime) {
    case "image/jpeg":
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case "image/png":
      return (
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4e &&
        buf[3] === 0x47 &&
        buf[4] === 0x0d &&
        buf[5] === 0x0a &&
        buf[6] === 0x1a &&
        buf[7] === 0x0a
      );
    case "image/webp":
      return (
        buf.toString("ascii", 0, 4) === "RIFF" &&
        buf.toString("ascii", 8, 12) === "WEBP"
      );
    default:
      return false;
  }
}

/** Message destiné au candidat pour chaque cause de rejet. */
export function photoErrorMessage(error: PhotoDecodeError): string {
  switch (error) {
    case "missing":
      return "Aucune image reçue.";
    case "unsupported_type":
      return "Format non accepté. Utilisez un JPEG, un PNG ou un WebP.";
    case "too_large":
      return `Image trop lourde (maximum ${Math.round(MAX_PHOTO_BYTES / 1024)} Ko).`;
    case "malformed":
    default:
      return "Image illisible. Réessayez avec une autre photo.";
  }
}
