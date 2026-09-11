import type { Metadata } from 'next'
import { resolveLocale } from '@/i18n'
import { getLegalIdentity } from '@/server/settings/legal'
import { Article, IdentityBlock, LegalLayout } from '@/components/marketing/LegalLayout'

export const metadata: Metadata = { title: 'Mentions légales — Evoliia' }

export default async function LegalNoticePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const locale = resolveLocale((await params).locale)
  const identity = await getLegalIdentity()

  return (
    <LegalLayout locale={locale} title="Mentions légales" updatedAt="11 septembre 2026">
      <IdentityBlock identity={identity} />

      <Article title="Hébergement">
        <p className="m-0">
          Le site et l’application sont hébergés par Vercel Inc. La base de données est
          hébergée par Supabase Inc. Les textes que vous soumettez à l’assistant sont
          traités par Anthropic PBC. Ces prestataires sont détaillés dans la politique de
          confidentialité.
        </p>
      </Article>

      <Article title="Propriété des contenus">
        <p className="m-0">
          Les applications que vous créez avec Evoliia vous appartiennent, ainsi que les
          textes, images et données que vous y placez. Evoliia n’en revendique aucun droit
          d’exploitation.
        </p>
        <p className="m-0">
          La plateforme elle-même, son nom, son logo et son interface restent la propriété
          de son éditeur.
        </p>
      </Article>

      <Article title="Applications de démonstration">
        <p className="m-0">
          Les applications présentées sur la page d’accueil, comme DevisFlow, Bookizy ou
          Cooksy, sont des démonstrations créées par l’éditeur pour montrer ce que la
          plateforme produit. Ce ne sont ni des clients, ni des entreprises réelles, et
          les tarifs qui y figurent sont fictifs.
        </p>
      </Article>

      <Article title="Signaler un contenu">
        <p className="m-0">
          Si une application publiée avec Evoliia vous semble illicite ou porte atteinte à
          vos droits, écrivez à l’adresse de contact ci-dessus en indiquant son adresse et
          le motif. Chaque signalement est examiné.
        </p>
      </Article>
    </LegalLayout>
  )
}
