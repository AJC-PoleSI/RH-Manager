import type { Metadata } from "next";
import LegalBackButton from "@/components/legal/LegalBackButton";

export const metadata: Metadata = {
  title: "Politique de confidentialité — RH Manager",
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900 mb-2">{title}</h2>
      {children}
    </section>
  );
}

function List({ children }: { children: React.ReactNode }) {
  return (
    <ul className="mt-2 space-y-1 list-disc pl-5 text-gray-600">{children}</ul>
  );
}

export default function PolitiqueConfidentialitePage() {
  return (
    <div className="min-h-dscreen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
        <LegalBackButton />

        <h1 className="text-3xl font-semibold text-gray-900 mb-8">
          Politique de confidentialité
        </h1>

        <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-8 space-y-6 text-sm text-gray-700 leading-relaxed">
          <p>
            Cette politique explique comment Audencia Junior Conseil traite les
            données personnelles collectées sur RH Manager, sa plateforme de
            recrutement, que vous soyez candidat(e) ou membre de
            l&apos;association.
          </p>

          <Section title="1. Responsable du traitement">
            <p>
              Audencia Junior Conseil, association loi 1901, SIRET 331 647 750
              00016, dont le siège est situé 8 route de la Jonelière, BP 31222,
              44312 Nantes Cedex 3. Contact : contact@ajc-mail.com.
            </p>
          </Section>

          <Section title="2. Données collectées">
            <p className="font-medium text-gray-900">Candidats</p>
            <List>
              <li>
                Identité et contact : nom, prénom, adresse email Audencia,
                numéro de téléphone (facultatif), date de naissance (qui sert
                aussi à vous reconnecter)
              </li>
              <li>Parcours : formation, établissement, année d&apos;intégration</li>
              <li>Photo (facultative), présentée au jury</li>
              <li>
                Déroulé du recrutement : créneaux et épreuves, vœux de pôles,
                évaluations, notes et commentaires du jury, marques de
                préférence des membres, résultats des délibérations
              </li>
              <li>Messages échangés sur la plateforme et notifications</li>
            </List>

            <p className="font-medium text-gray-900 mt-4">Membres</p>
            <List>
              <li>Nom, prénom, adresse email, pôle et poste</li>
              <li>Mot de passe, stocké uniquement sous forme chiffrée irréversible (hachage)</li>
              <li>Disponibilités, évaluations rédigées, messages</li>
            </List>

            <p className="font-medium text-gray-900 mt-4">
              Données techniques (tous les utilisateurs)
            </p>
            <List>
              <li>
                Adresse IP associée aux tentatives de connexion et
                d&apos;inscription, utilisée pour bloquer les abus
              </li>
              <li>Journaux techniques de l&apos;hébergeur</li>
              <li>
                Statistiques de fréquentation et de performance anonymes, sans
                cookie (Vercel Web Analytics et Speed Insights)
              </li>
            </List>
          </Section>

          <Section title="3. Finalités et bases légales">
            <List>
              <li>
                <strong>Gérer votre candidature</strong> : inscription,
                planning des épreuves, salles, jurys, évaluations,
                délibérations et communication avec vous. Base légale : mesures
                précontractuelles prises à votre demande en vue de votre
                adhésion (art. 6.1.b RGPD).
              </li>
              <li>
                <strong>Préparer votre adhésion</strong> : à l&apos;inscription,
                un compte est créé à votre nom dans Be Fast, l&apos;outil de
                gestion interne de l&apos;association. Même base légale.
              </li>
              <li>
                <strong>Afficher votre photo au jury</strong> : sur la base de
                votre consentement (art. 6.1.a RGPD), que vous pouvez retirer à
                tout moment en supprimant la photo depuis votre espace.
              </li>
              <li>
                <strong>Gérer les comptes des membres</strong> et
                l&apos;organisation des jurys : exécution de l&apos;adhésion à
                l&apos;association (art. 6.1.b RGPD).
              </li>
              <li>
                <strong>Sécuriser la plateforme</strong> et produire des
                statistiques globales sur le recrutement : intérêt légitime
                de l&apos;association (art. 6.1.f RGPD).
              </li>
            </List>
            <p className="mt-3">
              Aucune décision n&apos;est prise sur le seul fondement d&apos;un
              traitement automatisé : la répartition dans les créneaux peut être
              calculée par l&apos;outil, mais l&apos;admission est toujours
              décidée par le jury.
            </p>
          </Section>

          <Section title="4. Destinataires">
            <List>
              <li>
                <strong>Administrateurs de la plateforme</strong> : accès à
                l&apos;ensemble du dossier des candidats.
              </li>
              <li>
                <strong>Membres du jury</strong> : accès limité au nom, au
                prénom, au téléphone, à la photo et aux évaluations, notes et
                commentaires des candidats.
              </li>
              <li>
                <strong>Be Fast</strong>, l&apos;outil de gestion interne de
                l&apos;association, reçoit vos nom, prénom, email et date de
                naissance à la création de votre compte.
              </li>
              <li>
                <strong>Prestataires techniques</strong>, qui agissent sur
                instruction de l&apos;association : Supabase (base de données,
                hébergée à Francfort, Union européenne), Vercel Inc.
                (hébergement de l&apos;application et statistiques de
                fréquentation, États-Unis), Resend (envoi des emails,
                États-Unis) et Brevo (envoi des emails en secours, France).
              </li>
            </List>
            <p className="mt-3">
              Vos données ne sont ni vendues ni transmises à des tiers à des
              fins commerciales.
            </p>
          </Section>

          <Section title="5. Transferts hors de l'Union européenne">
            <p>
              Certains prestataires sont établis aux États-Unis. Ces transferts
              sont encadrés par des garanties appropriées : certification de
              Vercel au Data Privacy Framework UE–États-Unis, et clauses
              contractuelles types de la Commission européenne pour les autres
              prestataires.
            </p>
          </Section>

          <Section title="6. Durée de conservation">
            <List>
              <li>
                Candidats : pendant le recrutement, puis 12 mois après sa
                clôture. Pour les candidats retenus, les données utiles à
                l&apos;adhésion sont conservées dans Be Fast pendant la durée
                de l&apos;adhésion.
              </li>
              <li>Membres : pendant la durée de leur mandat.</li>
              <li>Données techniques de sécurité : 12 mois au plus.</li>
            </List>
            <p className="mt-3">
              Vous pouvez demander la suppression de vos données avant ces
              échéances (voir ci-dessous).
            </p>
          </Section>

          <Section title="7. Sécurité">
            <p>
              L&apos;association met en œuvre des mesures techniques et
              organisationnelles adaptées : échanges chiffrés (HTTPS), mots de
              passe hachés, accès aux données limité selon le rôle et contrôlé
              côté serveur, base de données non accessible publiquement,
              limitation des tentatives de connexion.
            </p>
          </Section>

          <Section title="8. Vos droits">
            <p>
              Conformément au RGPD et à la loi Informatique et Libertés, vous
              disposez des droits suivants sur vos données :
            </p>
            <List>
              <li>accès et copie</li>
              <li>rectification</li>
              <li>effacement</li>
              <li>limitation du traitement</li>
              <li>opposition au traitement fondé sur l&apos;intérêt légitime</li>
              <li>portabilité</li>
              <li>retrait de votre consentement à tout moment</li>
              <li>
                définition de directives sur le sort de vos données après votre
                décès
              </li>
            </List>
            <p className="mt-3">
              Pour les exercer, écrivez à <strong>contact@ajc-mail.com</strong>.
              Les candidats peuvent aussi utiliser le bouton « Demander la
              suppression de mon compte » dans leur profil. Nous répondons dans
              un délai d&apos;un mois.
            </p>
            <p className="mt-2">
              Si vous estimez que vos droits ne sont pas respectés, vous pouvez
              adresser une réclamation à la CNIL :{" "}
              <a
                href="https://www.cnil.fr/fr/plaintes"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                www.cnil.fr
              </a>
              .
            </p>
          </Section>

          <Section title="9. Cookies et stockage local">
            <p>
              La plateforme ne dépose aucun cookie publicitaire ni de suivi.
              Votre session de connexion est conservée dans le stockage local
              de votre navigateur. Ce stockage est strictement nécessaire au
              service et ne requiert donc pas de consentement. Les statistiques
              de fréquentation sont anonymes et fonctionnent sans cookie.
            </p>
          </Section>

          <Section title="10. Modification de cette politique">
            <p>
              Cette politique peut être mise à jour, par exemple lorsque la
              plateforme évolue. La date de dernière mise à jour figure
              ci-dessous.
            </p>
          </Section>
        </div>

        <p className="text-xs text-gray-400 mt-8 text-center">
          Dernière mise à jour : 24 septembre 2026
        </p>
      </div>
    </div>
  );
}
