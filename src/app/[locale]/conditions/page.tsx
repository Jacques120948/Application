import type { Metadata } from 'next'
import { resolveLocale } from '@/i18n'
import { getLegalIdentity } from '@/server/settings/legal'
import { Article, IdentityBlock, LegalLayout } from '@/components/marketing/LegalLayout'

export const metadata: Metadata = { title: 'Conditions d’utilisation — Evoliia' }

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale)
  const identity = await getLegalIdentity()

  return (
    <LegalLayout locale={locale} title="Conditions d’utilisation" updatedAt="11 septembre 2026">
      <Article title="Ce que fait Evoliia">
        <p className="m-0">
          Evoliia aide une personne qui ne sait pas coder à trouver une idée d’application,
          à en mesurer le potentiel, à la construire et à préparer son lancement. Les
          applications produites sont des applications web, consultables depuis un
          navigateur, y compris sur téléphone.
        </p>
        <p className="m-0">
          La plateforme est en développement actif. Des fonctions apparaissent, changent ou
          disparaissent. Nous nous engageons à le signaler plutôt qu’à le masquer.
        </p>
      </Article>

      <Article title="Ce qu’Evoliia ne garantit pas">
        <p className="m-0">
          Aucun revenu n’est promis, suggéré ni garanti. Les montants affichés dans le
          parcours, prix conseillé et nombre de clients, sont des calculs arithmétiques à
          partir de l’objectif que vous indiquez. Ce ne sont pas des prévisions.
        </p>
        <p className="m-0">
          Aucune publication sur l’App Store ou sur Google Play n’est promise. Ces
          boutiques décident seules d’accepter ou de refuser une application.
        </p>
        <p className="m-0">
          Aucune disponibilité permanente n’est garantie. Le service peut être interrompu
          pour maintenance, incident ou évolution.
        </p>
      </Article>

      <Article title="Votre compte">
        <p className="m-0">
          Vous créez un compte avec une adresse e-mail valide et un mot de passe. Vous êtes
          responsable de la confidentialité de ce mot de passe et des actions faites depuis
          votre compte.
        </p>
        <p className="m-0">
          Vous devez avoir la capacité juridique de contracter. Un compte est personnel :
          ne le partagez pas.
        </p>
      </Article>

      <Article title="Ce que vous créez">
        <p className="m-0">
          Les applications que vous créez vous appartiennent. Vous en êtes responsable :
          leur contenu, leur conformité, et l’usage qu’en font vos propres utilisateurs.
        </p>
        <p className="m-0">
          Vous vous engagez à ne pas créer d’application illicite, trompeuse, haineuse,
          contrefaisante, ni destinée à collecter des données sensibles sans base légale.
          Une application manifestement illicite peut être retirée sans préavis.
        </p>
      </Article>

      <Article title="Crédits et offres">
        <p className="m-0">
          Les opérations qui font appel à l’intelligence artificielle consomment des
          crédits. Chaque offre en accorde un nombre par mois. Les crédits non utilisés ne
          sont ni reportés, ni remboursés, ni transférables.
        </p>
        <p className="m-0">
          Le paiement en ligne n’est pas encore activé. Aucune somme ne vous est prélevée
          aujourd’hui. Lorsque le paiement sera disponible, les conditions tarifaires
          applicables vous seront présentées avant tout engagement.
        </p>
      </Article>

      <Article title="Suspension et résiliation">
        <p className="m-0">
          Vous pouvez cesser d’utiliser Evoliia à tout moment et demander la suppression de
          votre compte en écrivant à l’adresse de contact. La suppression intervient sous
          trente jours et efface vos projets.
        </p>
        <p className="m-0">
          Nous pouvons suspendre un compte en cas d’usage abusif, de tentative de
          contournement des limites ou d’activité illicite. Sauf urgence, vous en êtes
          informé.
        </p>
      </Article>

      <Article title="Responsabilité">
        <p className="m-0">
          Evoliia est fourni en l’état. Dans les limites permises par la loi, la
          responsabilité de l’éditeur est limitée aux dommages directs et prévisibles, et
          ne couvre ni les pertes de revenus, ni les pertes de clientèle, ni les pertes de
          données dont vous n’auriez pas conservé de copie.
        </p>
      </Article>

      <Article title="Droit applicable">
        <p className="m-0">
          Ces conditions sont soumises au droit suisse. En cas de litige, et à défaut
          d’accord amiable, le for est celui du siège de l’éditeur, sous réserve des règles
          protectrices applicables aux consommateurs.
        </p>
      </Article>

      <Article title="Modification des conditions">
        <p className="m-0">
          Ces conditions peuvent évoluer. En cas de changement significatif, vous en êtes
          informé par e-mail ou lors de votre prochaine connexion, avant application.
        </p>
      </Article>

      <Article title="L’éditeur">
        <IdentityBlock identity={identity} />
      </Article>
    </LegalLayout>
  )
}
