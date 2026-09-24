"use client";

// Espace d'un candidat refusé : son compte reste ouvert, mais à la place du
// calendrier, des épreuves et des vœux il ne voit plus que le message de refus
// reçu par email. Son profil et ses messages restent accessibles.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useCandidateStatus } from "@/context/CandidateStatusContext";
import AnnouncementBanner from "@/components/candidates/AnnouncementBanner";

/** Pages que garde un candidat refusé. */
const OPEN_TO_ELIMINATED = ["/candidates/profile", "/candidates/messages"];

export default function EliminationGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const ctx = useCandidateStatus();

  // Tant que le statut n'est pas connu, on n'affiche pas le planning : un
  // refusé ne doit pas l'entrevoir le temps d'un chargement.
  if (ctx?.loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="animate-spin text-gray-400" size={28} />
      </div>
    );
  }

  const status = ctx?.status;
  const stillOpen = OPEN_TO_ELIMINATED.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  if (!status?.eliminated || stillOpen) return <>{children}</>;

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-12">
      <AnnouncementBanner />

      {/* Même présentation et même texte que l'email de résultat. */}
      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="bg-[#E8446A] px-6 py-7 text-center">
          <p className="text-xs uppercase tracking-wider text-white/85">
            Audencia Junior Conseil
          </p>
          <h1 className="mt-2 text-xl font-bold text-white">
            Résultat de votre candidature
          </h1>
        </div>
        <div className="px-6 py-7 sm:px-10">
          <p className="text-base font-semibold text-gray-900">
            Bonjour {status.firstName},
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-gray-600 whitespace-pre-line">
            {status.message}
          </p>
        </div>
        <div className="border-t border-gray-100 bg-gray-50 px-6 py-4 text-sm text-gray-500 sm:px-10">
          Votre compte reste accessible :{" "}
          <Link
            href="/candidates/profile"
            className="font-medium text-gray-700 underline underline-offset-2"
          >
            Mon profil
          </Link>{" "}
          et{" "}
          <Link
            href="/candidates/messages"
            className="font-medium text-gray-700 underline underline-offset-2"
          >
            Messages
          </Link>
          .
        </div>
      </section>
    </div>
  );
}
