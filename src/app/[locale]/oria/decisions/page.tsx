import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { listSites, readDashboard } from '@/server/audit/service'
import { lireDecisions } from '@/server/oria/decisions'
import { Shell } from '@/components/studio/Shell'
import { DecisionsOria, OngletsOria } from '@/components/studio/Oria'

/**
 * Le journal des décisions d'Oria.
 *
 * Gratuit, et lu à la source : chaque décision vient du journal du spécialiste qui l'a
 * portée. L'impact est une évolution observée après, sur des fenêtres égales, jamais un
 * effet démontré.
 */
export const maxDuration = 60

export default async function DecisionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ siteId?: string }>
}) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const demande = await searchParams
  const [credits, sites, tableau] = await Promise.all([
    availableCredits(user.id),
    listSites(user.id),
    readDashboard(user.id, demande.siteId).catch(() => null),
  ])
  const siteId = tableau?.site.id ?? ''
  const decisions = await lireDecisions(user.id, siteId === '' ? null : siteId)

  return (
    <Shell
      locale={locale}
      userName={user.name}
      credits={credits}
      isAdmin={user.role === 'ADMIN'}
      screen="visibilite"
      menu="oria"
      siteId={siteId}
      sites={sites.map((site) => ({ id: site.id, host: site.host }))}
    >
      <div className="mx-auto grid w-full max-w-3xl gap-6 px-5 py-10">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">Décisions marketing</h1>
          <p className="mt-2 mb-4 text-sm leading-relaxed text-[var(--color-ink-soft)]">
            Ce qui a été décidé ces trois derniers mois, qui l’avait proposé, et ce qu’on a
            observé après. Une évolution observée n’est pas un effet prouvé : sur quelques jours,
            beaucoup de choses bougent en même temps.
          </p>
          <OngletsOria courant="decisions" locale={locale} siteId={siteId} />
        </div>
        <DecisionsOria decisions={decisions} />
      </div>
    </Shell>
  )
}
