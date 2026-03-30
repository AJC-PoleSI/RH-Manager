import Link from 'next/link';

export default function MentionsLegalesPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <Link href="/" className="text-sm text-blue-600 hover:underline mb-8 inline-block">
          &larr; Retour a l&apos;accueil
        </Link>

        <h1 className="text-3xl font-bold text-gray-900 mb-8">Mentions legales</h1>

        <div className="bg-white rounded-xl border border-gray-200 p-8 space-y-6 text-sm text-gray-700 leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Editeur du site</h2>
            <p>
              Ce site est edite par la Junior-Entreprise ESSEC dans le cadre de la gestion
              de son processus de recrutement interne.
            </p>
            <ul className="mt-2 space-y-1 text-gray-600">
              <li><strong>Denomination :</strong> Junior-Entreprise ESSEC</li>
              <li><strong>Forme juridique :</strong> Association loi 1901</li>
              <li><strong>Siege social :</strong> ESSEC Business School, 3 Avenue Bernard Hirsch, 95021 Cergy-Pontoise</li>
              <li><strong>Email :</strong> contact@junior-essec.com</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Directeur de la publication</h2>
            <p>Le directeur de la publication est le/la President(e) de la Junior-Entreprise.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Hebergement</h2>
            <p>
              Ce site est heberge par Vercel Inc., 440 N Bayard St #201, Wilmington, DE 19801, Etats-Unis.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Propriete intellectuelle</h2>
            <p>
              L&apos;ensemble des contenus (textes, images, logos, elements graphiques) presentes sur ce site
              sont la propriete exclusive de la Junior-Entreprise ESSEC ou de ses partenaires.
              Toute reproduction, representation, modification ou exploitation, meme partielle,
              est interdite sans autorisation ecrite prealable.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Donnees personnelles</h2>
            <p>
              Les donnees collectees sur ce site sont traitees conformement au Reglement General
              sur la Protection des Donnees (RGPD). Pour en savoir plus, consultez notre{' '}
              <Link href="/politique-confidentialite" className="text-blue-600 hover:underline">
                Politique de confidentialite
              </Link>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Cookies</h2>
            <p>
              Ce site utilise des cookies strictement necessaires au fonctionnement de l&apos;application
              (authentification, session). Aucun cookie publicitaire ou de tracking n&apos;est utilise.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Contact</h2>
            <p>
              Pour toute question relative aux mentions legales, vous pouvez nous contacter
              a l&apos;adresse : <strong>contact@junior-essec.com</strong>
            </p>
          </section>
        </div>

        <p className="text-xs text-gray-400 mt-8 text-center">
          Derniere mise a jour : Mars 2026
        </p>
      </div>
    </div>
  );
}
