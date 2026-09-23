import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { getEntitlements } from '@/server/billing/entitlements'
import { listSites } from '@/server/audit/service'
import { Shell } from '@/components/studio/Shell'
import { Card, CardBody, LinkButton } from '@/components/ui'
import { EnteteLina, OngletsLina, type OngletLina } from '@/components/studio/Lina'

/**
 * Ce que les écrans de Lina partagent : la personne, ses droits, son site, le cadre.
 * Une seule lecture des droits : un onglet qui oublierait `lina_agent` ouvrirait par la
 * bande ce que l'offre ferme.
 */
export async function ouvrirLina(params: Promise<{ locale: string }>, siteDemande: string | undefined) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)
  const [credits, sites, droits] = await Promise.all([availableCredits(user.id), listSites(user.id), getEntitlements(user.id)])
  const siteId = sites.find((site) => site.id === siteDemande)?.id ?? sites[0]?.id ?? ''
  return { locale, user, credits, sites, siteId, ouvert: droits.granted.includes('lina_agent') }
}

export function CadreLina({
  contexte,
  courant,
  onglets,
  children,
}: {
  contexte: Awaited<ReturnType<typeof ouvrirLina>>
  courant: OngletLina
  onglets: boolean
  children: ReactNode
}) {
  const { locale, user, credits, sites, siteId, ouvert } = contexte
  const suffixe = siteId === '' ? '' : `?siteId=${siteId}`
  return (
    <Shell
      locale={locale}
      userName={user.name}
      credits={credits}
      isAdmin={user.role === 'ADMIN'}
      screen="visibilite"
      menu="lina"
      siteId={siteId}
      sites={sites.map((site) => ({ id: site.id, host: site.host }))}
    >
      <div className="mx-auto grid w-full max-w-3xl gap-6 px-5 py-10">
        <EnteteLina
          versAnalyse={courant === 'tableau' ? '#analyse' : `/${locale}/lina${suffixe}#analyse`}
          versSegments={`/${locale}/lina/segments${suffixe}`}
          versConversation={siteId === '' ? `/${locale}/visibilite` : `/${locale}/visibilite/equipe?${suffixe.slice(1)}&agent=lina`}
        />
        {!ouvert ? (
          <Card>
            <CardBody>
              <p className="m-0 text-sm leading-relaxed">
                Lina n’est pas incluse dans votre offre actuelle. Elle segmente votre base clients, repère qui relancer et
                prépare vos campagnes de fidélisation.
              </p>
              <div className="mt-4">
                <LinkButton href={`/${locale}/abonnement`}>Voir les offres</LinkButton>
              </div>
            </CardBody>
          </Card>
        ) : (
          <>
            {onglets ? <OngletsLina courant={courant} locale={locale} siteId={siteId} /> : null}
            {children}
          </>
        )}
      </div>
    </Shell>
  )
}
