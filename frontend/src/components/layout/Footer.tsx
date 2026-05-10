import Link from "next/link";

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-300 mt-auto">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex flex-col md:flex-row md:justify-between gap-8">
          {/* Bloc 1 : Infos Audencia Junior Conseil */}
          <div className="space-y-3">
            <h3 className="text-white font-semibold text-lg tracking-tight">
              Audencia Junior Conseil
            </h3>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Contact
            </p>
            <ul className="space-y-1.5 text-sm">
              <li className="flex items-center gap-2">
                <svg
                  className="w-4 h-4 text-gray-400 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                  />
                </svg>
                +33 7 69 44 78 99
              </li>
              <li className="flex items-center gap-2">
                <svg
                  className="w-4 h-4 text-gray-400 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
                contact@ajc-mail.com
              </li>
              <li className="flex items-start gap-2">
                <svg
                  className="w-4 h-4 text-gray-400 shrink-0 mt-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                8 Route de la Joneliere, 44312 Nantes
              </li>
            </ul>
          </div>

          {/* Bloc 2 : Liens legaux */}
          <div className="flex flex-col items-start md:items-end gap-3 md:text-right">
            <p className="text-sm text-gray-400">
              &copy; 2026 Audencia Junior Conseil
            </p>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 text-sm">
              <Link
                href="/mentions-legales"
                className="text-gray-400 hover:text-white transition-colors"
              >
                Mentions legales
              </Link>
              <Link
                href="/politique-confidentialite"
                className="text-gray-400 hover:text-white transition-colors"
              >
                Politique de confidentialite
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Barre basse */}
      <div className="border-t border-gray-800">
        <div className="max-w-6xl mx-auto px-6 py-3">
          <p className="text-xs text-gray-500 text-center">
            AJC Recrutement - Application de gestion RH
          </p>
        </div>
      </div>
    </footer>
  );
}
