"use client";

// Relance « vos choix de pôles sont attendus », affichée sur l'accueil candidat.
//
// Rien ne bloque un candidat sans vœux (ni réservation, ni épreuve) : ce
// bandeau est le seul rappel qu'il voit à chaque connexion, en complément
// du mail de relance. La décision vient du serveur (`GET /api/wishes/status`)
// pour partager exactement le critère du cron — admis T1, en lice, sans vœu,
// vœux non verrouillés, Tour 2 non clos. Il disparaît dès qu'un vœu existe.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";

export default function WishesNudge() {
  const { user, role } = useAuth();
  const [needed, setNeeded] = useState(false);

  useEffect(() => {
    if (role !== "candidate" || !user?.id) return;
    let cancelled = false;
    api
      .get("/wishes/status")
      .then((res) => {
        if (!cancelled) setNeeded(res.data?.needsWishes === true);
      })
      .catch(() => {
        // Silencieux : le bandeau ne doit jamais casser l'accueil.
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, role]);

  if (!needed) return null;

  return (
    <Link
      href="/candidates/wishes"
      className="flex items-center gap-3 bg-[#EEF2FF] border border-[#C7D2FE] rounded-xl px-4 py-3 hover:bg-[#E0E7FF] transition-colors"
    >
      <span className="w-9 h-9 rounded-full bg-[#4F46E5] text-white flex items-center justify-center flex-shrink-0">
        <ListChecks size={17} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-[#3730A3]">
          Vos choix de pôles sont attendus
        </span>
        <span className="block text-sm text-[#4338CA]">
          Indicatifs, pas définitifs — ils nous aident à préparer le Tour 3.
        </span>
      </span>
      <span className="text-sm font-semibold text-[#4F46E5] whitespace-nowrap">
        Mes vœux →
      </span>
    </Link>
  );
}
