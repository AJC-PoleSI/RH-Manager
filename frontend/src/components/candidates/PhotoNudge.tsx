"use client";

// Relance « il manque votre photo », affichée sur l'accueil candidat.
//
// La photo n'est pas obligatoire (on ne bloque ni l'inscription ni la
// réservation d'un créneau) : la relance est le seul levier pour que le
// trombinoscope du jury soit complet. Elle disparaît dès que la photo existe.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Camera } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getCandidatePhotoUrl } from "@/lib/photo-cache";

export default function PhotoNudge() {
  const { user, role } = useAuth();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (role !== "candidate" || !user?.id) return;
    let cancelled = false;
    // Passe par le cache partagé : pas de route dédiée, et la vignette est
    // déjà chaude si le candidat file sur son profil.
    getCandidatePhotoUrl(user.id).then((url) => {
      if (!cancelled) setMissing(!url);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id, role]);

  if (!missing) return null;

  return (
    <Link
      href="/candidates/profile"
      className="flex items-center gap-3 bg-[#FFF0F3] border border-[#FFD3DC] rounded-xl px-4 py-3 hover:bg-[#FFE7ED] transition-colors"
    >
      <span className="w-9 h-9 rounded-full bg-[#E8446A] text-white flex items-center justify-center flex-shrink-0">
        <Camera size={17} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-[#B3244A]">
          Ajoutez votre photo
        </span>
        <span className="block text-sm text-[#8A2340]">
          Elle aide le jury à vous reconnaître pendant le recrutement. Une
          minute suffit.
        </span>
      </span>
      <span className="text-sm font-semibold text-[#E8446A] whitespace-nowrap">
        Mon profil →
      </span>
    </Link>
  );
}
