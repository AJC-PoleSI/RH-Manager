"use client";

// Vignette d'un candidat : sa photo si elle existe, ses initiales sinon.
//
// La photo est une donnée personnelle servie derrière un jeton : elle ne peut
// pas être chargée par un `<img src>` nu, d'où le passage par le cache
// authentifié (lib/photo-cache.ts). Tant qu'elle arrive, on affiche déjà les
// initiales — le trombinoscope reste lisible pendant le chargement.

import { useEffect, useState } from "react";
import { getCandidatePhotoUrl } from "@/lib/photo-cache";
import { cn } from "@/lib/utils";

interface CandidatePhotoProps {
  candidateId: string;
  firstName?: string | null;
  lastName?: string | null;
  /**
   * Renseigné par les listes (organigramme, délibérations) : évite une requête
   * vouée au 404 pour les candidats sans photo. `undefined` = on ne sait pas,
   * on tente.
   */
  hasPhoto?: boolean;
  /** Date de dernière mise à jour : sert de cache-buster. */
  version?: string | null;
  /**
   * Côté de la vignette en pixels. Avec `fill`, la vignette occupe la largeur
   * disponible et `size` ne sert plus qu'à dimensionner les initiales.
   */
  size?: number;
  /** Occupe toute la largeur du parent, en carré (grille du trombinoscope). */
  fill?: boolean;
  /** Grise la photo — utilisé pour les candidats éliminés. */
  grayscale?: boolean;
  /** Arrondi : `full` pour un rond, sinon un rayon Tailwind. */
  rounded?: string;
  className?: string;
}

/** Palette stable dérivée de l'id : deux candidats voisins n'ont pas la même. */
const INITIAL_COLORS = [
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
  "bg-orange-100 text-orange-700",
  "bg-indigo-100 text-indigo-700",
];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return INITIAL_COLORS[Math.abs(hash) % INITIAL_COLORS.length];
}

export default function CandidatePhoto({
  candidateId,
  firstName,
  lastName,
  hasPhoto,
  version,
  size = 48,
  fill = false,
  grayscale = false,
  rounded = "rounded-full",
  className,
}: CandidatePhotoProps) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (hasPhoto === false) {
      setUrl(null);
      return;
    }

    let cancelled = false;
    getCandidatePhotoUrl(candidateId, version).then((next) => {
      if (!cancelled) setUrl(next);
    });
    return () => {
      cancelled = true;
    };
  }, [candidateId, version, hasPhoto]);

  const initials =
    `${(firstName || "")[0] || ""}${(lastName || "")[0] || ""}`.toUpperCase() ||
    "?";

  const fullName = [firstName, lastName].filter(Boolean).join(" ");

  return (
    <div
      className={cn(
        "relative overflow-hidden flex items-center justify-center flex-shrink-0 select-none",
        rounded,
        fill && "w-full aspect-square",
        !url && colorFor(candidateId),
        grayscale && "grayscale opacity-60",
        className,
      )}
      style={fill ? undefined : { width: size, height: size }}
      title={fullName || undefined}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- object URL locale,
        // next/image ne sait pas optimiser un blob et ajouterait une requête.
        <img
          src={url}
          alt={fullName ? `Photo de ${fullName}` : "Photo du candidat"}
          className="w-full h-full object-cover"
          draggable={false}
        />
      ) : (
        <span
          className="font-bold leading-none"
          style={{ fontSize: Math.max(10, Math.round(size * 0.36)) }}
          aria-hidden="true"
        >
          {initials}
        </span>
      )}
    </div>
  );
}
