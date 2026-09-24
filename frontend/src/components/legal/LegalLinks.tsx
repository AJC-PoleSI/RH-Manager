import Link from "next/link";

// `newTab` : depuis un formulaire en cours de saisie, on ouvre les pages
// légales à côté pour ne pas faire perdre les champs déjà remplis.
export default function LegalLinks({
  newTab = false,
  className = "",
}: {
  newTab?: boolean;
  className?: string;
}) {
  const target = newTab
    ? { target: "_blank", rel: "noopener noreferrer" }
    : {};
  return (
    <div
      className={`flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-gray-400 ${className}`}
    >
      <Link
        href="/mentions-legales"
        className="hover:text-gray-600 hover:underline"
        {...target}
      >
        Mentions légales
      </Link>
      <Link
        href="/politique-confidentialite"
        className="hover:text-gray-600 hover:underline"
        {...target}
      >
        Politique de confidentialité
      </Link>
    </div>
  );
}
