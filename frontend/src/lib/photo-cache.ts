"use client";

// Cache des photos de candidats côté navigateur.
//
// La route /api/candidates/[id]/photo exige un jeton Bearer : un `<img src>`
// classique ne peut donc pas la charger. Chaque vignette passe par un `fetch`
// authentifié qui produit une object URL.
//
// Sans cache, l'organigramme (plusieurs dizaines de candidats) refetcherait
// tout à chaque rendu et à chaque aller-retour entre l'organigramme et la
// délibération. Ce module garde les object URLs vivantes pour la durée de
// l'onglet et fusionne les requêtes concurrentes sur un même candidat.

import api from "./api";

/** clé `id:version` → object URL (ou null si le candidat n'a pas de photo). */
const cache = new Map<string, string | null>();
/** Requêtes en vol, pour ne pas télécharger deux fois la même photo. */
const inflight = new Map<string, Promise<string | null>>();

function keyOf(candidateId: string, version?: string | null): string {
  return `${candidateId}:${version || "0"}`;
}

/**
 * Renvoie une object URL affichable, ou `null` si le candidat n'a pas de photo.
 *
 * `version` (la date de mise à jour renvoyée par l'API) fait office de
 * cache-buster : quand un candidat remplace sa photo, la clé change et
 * l'ancienne vignette est libérée.
 */
export async function getCandidatePhotoUrl(
  candidateId: string,
  version?: string | null,
): Promise<string | null> {
  const key = keyOf(candidateId, version);

  if (cache.has(key)) return cache.get(key) ?? null;

  const pending = inflight.get(key);
  if (pending) return pending;

  const request = api
    .get(`/candidates/${candidateId}/photo`, { responseType: "blob" })
    .then((res) => {
      const url = URL.createObjectURL(res.data as Blob);
      // Une version plus ancienne du même candidat n'a plus lieu d'être.
      releaseOtherVersions(candidateId, key);
      cache.set(key, url);
      return url;
    })
    .catch(() => {
      // 404 = pas de photo, c'est un cas normal (candidat qui n'en a pas
      // encore déposé). On mémorise l'absence pour ne pas la redemander.
      cache.set(key, null);
      return null;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, request);
  return request;
}

/** Libère les object URLs des autres versions du même candidat. */
function releaseOtherVersions(candidateId: string, keepKey: string) {
  const prefix = `${candidateId}:`;
  for (const [k, url] of Array.from(cache.entries())) {
    if (k !== keepKey && k.startsWith(prefix)) {
      if (url) URL.revokeObjectURL(url);
      cache.delete(k);
    }
  }
}

/**
 * Oublie la photo d'un candidat — à appeler après un dépôt ou une suppression
 * pour que la nouvelle image soit rechargée immédiatement.
 */
export function invalidateCandidatePhoto(candidateId: string) {
  const prefix = `${candidateId}:`;
  for (const [k, url] of Array.from(cache.entries())) {
    if (k.startsWith(prefix)) {
      if (url) URL.revokeObjectURL(url);
      cache.delete(k);
    }
  }
  for (const k of Array.from(inflight.keys())) {
    if (k.startsWith(prefix)) inflight.delete(k);
  }
}
