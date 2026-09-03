"use client";

// Redimensionnement de la photo AVANT envoi, dans le navigateur.
//
// Une photo prise au téléphone pèse 3 à 8 Mo. Telle quelle, elle serait
// rejetée par l'API (plafond 800 Ko) et un candidat n'a aucun moyen simple de
// la réduire lui-même. On la ramène donc ici à une vignette carrée de 512 px :
// c'est la seule taille dont le trombinoscope a besoin, et ça tient largement
// sous le plafond.

import { PHOTO_TARGET_SIZE } from "./candidate-photo";

export class PhotoResizeError extends Error {}

/** Formats que le sélecteur de fichier accepte. */
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";

/**
 * Lit un fichier image et renvoie une data URL JPEG carrée de 512 px,
 * recadrée au centre (le cadrage carré évite des vignettes de proportions
 * hétérogènes dans la grille du trombinoscope).
 */
export async function resizePhotoFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new PhotoResizeError("Ce fichier n'est pas une image.");
  }

  const bitmap = await loadBitmap(file);

  try {
    const size = PHOTO_TARGET_SIZE;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new PhotoResizeError("Impossible de préparer l'image.");

    // Fond blanc : un PNG transparent deviendrait noir en JPEG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);

    // Recadrage centré sur le plus petit côté.
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    if (!dataUrl.startsWith("data:image/jpeg;base64,")) {
      throw new PhotoResizeError("Impossible de convertir l'image.");
    }
    return dataUrl;
  } finally {
    if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();
  }
}

/**
 * `createImageBitmap` applique l'orientation EXIF — sans quoi les photos
 * prises en portrait ressortent couchées. Repli sur `<img>` pour les
 * navigateurs qui ne connaissent pas l'option.
 */
async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // certains Safari : option inconnue → on retente sans
      try {
        return await createImageBitmap(file);
      } catch {
        /* repli <img> ci-dessous */
      }
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new PhotoResizeError("Image illisible."));
    };
    img.src = url;
  });
}
