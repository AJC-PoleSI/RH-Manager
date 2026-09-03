import { describe, it, expect } from "vitest";
import {
  decodePhotoDataUrl,
  MAX_PHOTO_BYTES,
  photoErrorMessage,
} from "./candidate-photo";

/** Construit une data URL à partir d'octets bruts. */
function dataUrl(mime: string, bytes: number[]): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** En-têtes réels des formats acceptés, complétés pour dépasser 12 octets. */
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0, 0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0, 0];
const WEBP = [
  0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
];

describe("decodePhotoDataUrl", () => {
  it("accepte un JPEG, un PNG et un WebP", () => {
    for (const [mime, bytes] of [
      ["image/jpeg", JPEG],
      ["image/png", PNG],
      ["image/webp", WEBP],
    ] as const) {
      const res = decodePhotoDataUrl(dataUrl(mime, bytes as number[]));
      expect(res.ok, mime).toBe(true);
      if (res.ok) expect(res.photo.mimeType).toBe(mime);
    }
  });

  it("refuse une entrée vide ou non textuelle", () => {
    expect(decodePhotoDataUrl(undefined)).toEqual({ ok: false, error: "missing" });
    expect(decodePhotoDataUrl("")).toEqual({ ok: false, error: "missing" });
    expect(decodePhotoDataUrl(42)).toEqual({ ok: false, error: "missing" });
  });

  it("refuse ce qui n'est pas une data URL base64", () => {
    expect(decodePhotoDataUrl("https://exemple.fr/photo.jpg")).toEqual({
      ok: false,
      error: "malformed",
    });
  });

  it("refuse le SVG — c'est un document, il peut porter du script", () => {
    const svg = `data:image/svg+xml;base64,${Buffer.from(
      "<svg onload='alert(1)'></svg>",
    ).toString("base64")}`;
    expect(decodePhotoDataUrl(svg)).toEqual({
      ok: false,
      error: "unsupported_type",
    });
  });

  it("refuse un type MIME qui ment sur le contenu", () => {
    // Des octets JPEG annoncés en PNG : sans contrôle de signature, la route
    // GET servirait n'importe quoi sous un Content-Type choisi par l'envoyeur.
    expect(decodePhotoDataUrl(dataUrl("image/png", JPEG))).toEqual({
      ok: false,
      error: "unsupported_type",
    });
  });

  it("refuse une image au-delà du plafond", () => {
    const big = new Array(MAX_PHOTO_BYTES + 1024).fill(0);
    big.splice(0, JPEG.length, ...JPEG);
    expect(decodePhotoDataUrl(dataUrl("image/jpeg", big))).toEqual({
      ok: false,
      error: "too_large",
    });
  });

  it("accepte une image juste sous le plafond", () => {
    const justUnder = new Array(MAX_PHOTO_BYTES - 1024).fill(0);
    justUnder.splice(0, JPEG.length, ...JPEG);
    const res = decodePhotoDataUrl(dataUrl("image/jpeg", justUnder));
    expect(res.ok).toBe(true);
  });

  it("refuse un fichier trop court pour porter une signature", () => {
    expect(decodePhotoDataUrl(dataUrl("image/jpeg", [0xff, 0xd8]))).toEqual({
      ok: false,
      error: "unsupported_type",
    });
  });

  it("renvoie la taille décodée, pas la longueur base64", () => {
    const res = decodePhotoDataUrl(dataUrl("image/jpeg", JPEG));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.photo.byteSize).toBe(JPEG.length);
  });
});

describe("photoErrorMessage", () => {
  it("donne un message actionnable pour chaque cause", () => {
    expect(photoErrorMessage("unsupported_type")).toMatch(/JPEG/);
    expect(photoErrorMessage("too_large")).toMatch(/Ko/);
    expect(photoErrorMessage("malformed")).toMatch(/illisible/i);
    expect(photoErrorMessage("missing")).toMatch(/Aucune image/i);
  });
});
