"use client";
import { useRouter } from "next/navigation";

// Les pages légales s'ouvrent souvent dans un nouvel onglet (lien depuis le
// formulaire d'inscription) : sans historique, router.back() ne ferait rien.
export default function LegalBackButton() {
  const router = useRouter();
  return (
    <button
      onClick={() =>
        window.history.length > 1 ? router.back() : router.push("/login")
      }
      className="text-sm text-blue-600 hover:underline mb-8 inline-block"
    >
      &larr; Retour
    </button>
  );
}
