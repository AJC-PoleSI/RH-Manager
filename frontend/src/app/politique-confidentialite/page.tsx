import Link from "next/link";

export default function PolitiqueConfidentialitePage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <Link
          href="/"
          className="text-sm text-blue-600 hover:underline mb-8 inline-block"
        >
          &larr; Retour a l&apos;accueil
        </Link>

        <h1 className="text-3xl font-semibold text-gray-900 mb-8">
          Politique de confidentialite
        </h1>

        <div className="bg-white rounded-xl border border-gray-200 p-8 space-y-6 text-sm text-gray-700 leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              1. Responsable du traitement
            </h2>
            <p>
              Le responsable du traitement des donnees personnelles est Audencia
              Junior Conseil, association loi 1901, dont le siege social est
              situe 8 Route de la Joneliere, 44312 Nantes.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              2. Donnees collectees
            </h2>
            <p>
              Dans le cadre du processus de recrutement, nous collectons les
              donnees suivantes :
            </p>
            <ul className="mt-2 space-y-1 list-disc list-inside text-gray-600">
              <li>Nom, prenom, adresse email</li>
              <li>Numero de telephone (optionnel)</li>
              <li>Formation et parcours academique</li>
              <li>Choix de poles et preferences</li>
              <li>Evaluations et notes attribuees lors des epreuves</li>
              <li>Disponibilites horaires des evaluateurs</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              3. Finalite du traitement
            </h2>
            <p>Les donnees collectees sont utilisees exclusivement pour :</p>
            <ul className="mt-2 space-y-1 list-disc list-inside text-gray-600">
              <li>
                La gestion du processus de recrutement (candidatures,
                evaluations, deliberations)
              </li>
              <li>
                L&apos;organisation logistique des epreuves (planning, salles,
                jurys)
              </li>
              <li>
                La communication avec les candidats et les membres evaluateurs
              </li>
              <li>
                L&apos;etablissement de statistiques anonymisees sur le
                recrutement
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              4. Base legale
            </h2>
            <p>
              Le traitement des donnees repose sur l&apos;interet legitime
              d&apos;Audencia Junior Conseil a gerer son processus de
              recrutement, ainsi que sur le consentement des candidats lors de
              leur inscription sur la plateforme.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              5. Duree de conservation
            </h2>
            <p>
              Les donnees des candidats sont conservees pendant la duree du
              processus de recrutement et jusqu&apos;a 12 mois apres la fin de
              celui-ci. Les donnees des membres evaluateurs sont conservees
              pendant la duree de leur mandat.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              6. Destinataires des donnees
            </h2>
            <p>
              Les donnees sont accessibles uniquement aux membres habilites
              d&apos;Audencia Junior Conseil (administrateurs et evaluateurs)
              dans le cadre strict de leurs missions de recrutement. Aucune
              donnee n&apos;est transmise a des tiers commerciaux.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              7. Securite des donnees
            </h2>
            <p>
              Nous mettons en oeuvre des mesures techniques et
              organisationnelles appropriees pour proteger vos donnees :
              chiffrement des mots de passe, acces restreint par
              authentification, hebergement securise, protocole HTTPS.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              8. Vos droits
            </h2>
            <p>Conformement au RGPD, vous disposez des droits suivants :</p>
            <ul className="mt-2 space-y-1 list-disc list-inside text-gray-600">
              <li>
                <strong>Droit d&apos;acces :</strong> obtenir une copie de vos
                donnees personnelles
              </li>
              <li>
                <strong>Droit de rectification :</strong> corriger des donnees
                inexactes ou incompletes
              </li>
              <li>
                <strong>Droit a l&apos;effacement :</strong> demander la
                suppression de vos donnees
              </li>
              <li>
                <strong>Droit a la portabilite :</strong> recevoir vos donnees
                dans un format structure
              </li>
              <li>
                <strong>Droit d&apos;opposition :</strong> vous opposer au
                traitement de vos donnees
              </li>
            </ul>
            <p className="mt-3">
              Pour exercer ces droits, contactez-nous a :{" "}
              <strong>contact@ajc-mail.com</strong>
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              9. Cookies
            </h2>
            <p>
              Cette application utilise uniquement des cookies techniques
              necessaires a son fonctionnement (jeton d&apos;authentification
              JWT). Aucun cookie de suivi, d&apos;analyse ou publicitaire
              n&apos;est utilise.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              10. Contact
            </h2>
            <p>
              Pour toute question concernant cette politique de confidentialite
              ou l&apos;exercice de vos droits, vous pouvez nous ecrire a :{" "}
              <strong>contact@ajc-mail.com</strong>
            </p>
            <p className="mt-2">
              Vous pouvez egalement introduire une reclamation aupres de la CNIL
              :{" "}
              <a
                href="https://www.cnil.fr"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                www.cnil.fr
              </a>
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
