import type { Metadata } from "next";
import Link from "next/link";
import LegalBackButton from "@/components/legal/LegalBackButton";

export const metadata: Metadata = {
  title: "Mentions légales — RH Manager",
};

export default function MentionsLegalesPage() {
  return (
    <div className="min-h-dscreen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
        <LegalBackButton />

        <h1 className="text-3xl font-semibold text-gray-900 mb-8">
          Mentions légales
        </h1>

        <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-8 space-y-6 text-sm text-gray-700 leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              Éditeur du site
            </h2>
            <p>
              La plateforme RH Manager est éditée par Audencia Junior Conseil
              pour la gestion de son processus de recrutement.
            </p>
            <ul className="mt-2 space-y-1 text-gray-600">
              <li>
                <strong>Dénomination :</strong> Audencia Junior Conseil
              </li>
              <li>
                <strong>Forme juridique :</strong> association loi 1901
              </li>
              <li>
                <strong>SIRET :</strong> 331 647 750 00016
              </li>
              <li>
                <strong>Siège social :</strong> 8 route de la Jonelière, BP
                31222, 44312 Nantes Cedex 3
              </li>
              <li>
                <strong>Téléphone :</strong> +33 7 69 44 78 99
              </li>
              <li>
                <strong>Email :</strong> contact@ajc-mail.com
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              Directrice de la publication
            </h2>
            <p>
              Emilie Munsch, Présidente d&apos;Audencia Junior Conseil.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              Hébergement
            </h2>
            <p>L&apos;application est hébergée par :</p>
            <ul className="mt-2 space-y-1 text-gray-600">
              <li>
                <strong>Vercel Inc.</strong>, 440 N Barranca Avenue #4133,
                Covina, CA 91723, États-Unis (vercel.com)
              </li>
            </ul>
            <p className="mt-2">Les données sont stockées par :</p>
            <ul className="mt-2 space-y-1 text-gray-600">
              <li>
                <strong>Supabase Pte. Ltd.</strong> (supabase.com), sur des
                serveurs situés à Francfort (Allemagne, Union européenne)
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              Propriété intellectuelle
            </h2>
            <p>
              L&apos;ensemble des contenus de ce site (textes, images, logos,
              éléments graphiques) est la propriété d&apos;Audencia Junior
              Conseil ou de ses partenaires. Toute reproduction, représentation,
              modification ou exploitation, même partielle, est interdite sans
              autorisation écrite préalable.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              Données personnelles
            </h2>
            <p>
              Les données collectées sur cette plateforme sont traitées
              conformément au Règlement général sur la protection des données
              (RGPD) et à la loi Informatique et Libertés. Le détail des
              traitements et de vos droits figure dans la{" "}
              <Link
                href="/politique-confidentialite"
                className="text-blue-600 hover:underline"
              >
                politique de confidentialité
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              Cookies
            </h2>
            <p>
              La plateforme ne dépose aucun cookie publicitaire ni de suivi. Le
              maintien de votre connexion repose sur un stockage local
              strictement nécessaire au fonctionnement du service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              Contact
            </h2>
            <p>
              Pour toute question relative au site, écrivez à{" "}
              <strong>contact@ajc-mail.com</strong>.
            </p>
          </section>
        </div>

        <p className="text-xs text-gray-400 mt-8 text-center">
          Dernière mise à jour : 24 septembre 2026
        </p>
      </div>
    </div>
  );
}
