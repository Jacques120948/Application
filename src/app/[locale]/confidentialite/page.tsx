import type { Metadata } from 'next'
import { resolveLocale } from '@/i18n'
import { getLegalIdentity } from '@/server/settings/legal'
import { Article, IdentityBlock, LegalLayout } from '@/components/marketing/LegalLayout'

export const metadata: Metadata = { title: 'Confidentialité — Evoliia' }

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale)
  const identity = await getLegalIdentity()

  return (
    <LegalLayout
      locale={locale}
      title="Politique de confidentialité"
      updatedAt="11 septembre 2026"
    >
      <Article title="Qui traite vos données">
        <IdentityBlock identity={identity} />
      </Article>

      <Article title="Ce que nous collectons">
        <p className="m-0">
          À la création du compte : votre adresse e-mail, votre prénom si vous l’indiquez,
          votre langue, et votre mot de passe sous forme d’empreinte chiffrée. Le mot de
          passe lui-même n’est jamais enregistré.
        </p>
        <p className="m-0">
          Pendant le parcours : l’objectif de revenu que vous visez, le temps dont vous
          disposez, votre budget, votre pays, votre secteur, vos compétences et vos centres
          d’intérêt. Ces informations servent à vous proposer des idées adaptées.
        </p>
        <p className="m-0">
          Pendant la construction : la description de vos applications, leur contenu et les
          données que vous y enregistrez.
        </p>
        <p className="m-0">
          Techniquement : la date de vos connexions, votre adresse IP et votre navigateur,
          conservés pour la sécurité des comptes et la limitation des abus.
        </p>
      </Article>

      <Article title="Pourquoi">
        <p className="m-0">
          Pour vous fournir le service, pour sécuriser les comptes, pour mesurer la
          consommation de crédits, et pour vous écrire lorsque c’est nécessaire, par
          exemple pour réinitialiser un mot de passe.
        </p>
        <p className="m-0">
          Nous ne vendons aucune donnée. Nous ne faisons pas de publicité ciblée.
        </p>
      </Article>

      <Article title="À qui ces données sont transmises">
        <p className="m-0">
          Vercel Inc. héberge le site et l’application. Supabase Inc. héberge la base de
          données.
        </p>
        <p className="m-0">
          Anthropic PBC traite les textes que vous soumettez à l’assistant : votre profil,
          vos idées, vos demandes de modification. C’est nécessaire pour que l’assistant
          réponde. N’y écrivez pas d’information que vous ne voudriez pas transmettre à un
          prestataire tiers.
        </p>
        <p className="m-0">
          Resend Inc. achemine les e-mails transactionnels, lorsque cette fonction est
          activée sur l’installation.
        </p>
        <p className="m-0">
          Ces prestataires sont situés hors de Suisse et de l’Union européenne. Les
          transferts s’appuient sur leurs engagements contractuels respectifs.
        </p>
      </Article>

      <Article title="Combien de temps">
        <p className="m-0">
          Vos données sont conservées tant que votre compte existe. À la suppression du
          compte, elles sont effacées sous trente jours, y compris vos projets et les
          données de vos applications.
        </p>
        <p className="m-0">
          Les journaux techniques sont conservés au maximum douze mois.
        </p>
      </Article>

      <Article title="Vos droits">
        <p className="m-0">
          Vous pouvez demander l’accès à vos données, leur correction, leur suppression, ou
          vous opposer à un traitement. Écrivez à l’adresse de contact indiquée plus haut.
          Une réponse vous est apportée dans un délai d’un mois.
        </p>
        <p className="m-0">
          Si la réponse ne vous satisfait pas, vous pouvez saisir l’autorité de protection
          des données de votre pays.
        </p>
      </Article>

      <Article title="Cookies">
        <p className="m-0">
          Evoliia dépose un seul cookie, celui de votre session, nécessaire pour vous
          garder connecté. Il n’y a ni cookie publicitaire, ni traceur, ni outil de mesure
          d’audience tiers.
        </p>
      </Article>

      <Article title="Sécurité">
        <p className="m-0">
          Les mots de passe sont protégés par une fonction de dérivation résistante aux
          attaques matérielles. Les jetons de session ne sont stockés que sous forme
          d’empreinte.
        </p>
        <p className="m-0">
          Les données de chaque créateur sont cloisonnées au niveau de la base elle-même :
          une requête ne peut pas atteindre les projets d’un autre compte, même en cas
          d’erreur applicative. Ce cloisonnement est vérifié automatiquement à chaque mise
          en ligne.
        </p>
      </Article>
    </LegalLayout>
  )
}
