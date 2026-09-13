import { redirect } from 'next/navigation'
import { getTranslator, resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { getWallet } from '@/server/billing/credits'
import { getEntitlements } from '@/server/billing/entitlements'
import { isEnabled } from '@/server/settings/flags'
import { getProfile } from '@/server/business/profile'
import {
  COMPARE_ESTIMATED_CREDITS,
  RADAR_ESTIMATED_CREDITS,
  RADAR_FEATURE,
  getRadarOverview,
  readRadarAlerts,
} from '@/server/radar/service'
import { signalSourcesStatus } from '@/server/radar/signals'
import { listProjects } from '@/server/projects/service'
import { Shell } from '@/components/studio/Shell'
import { Card } from '@/components/ui'
import { RadarBoard } from '@/components/studio/RadarBoard'

/**
 * Le Radar d'opportunités.
 *
 * Même point de départ que les idées du parcours : un profil terminé. La différence est
 * dans la porte d'entrée : le module peut être fermé sur l'installation (drapeau) ou absent
 * de l'offre de la personne. Dans les deux cas on affiche une explication, jamais une
 * erreur, et on ne charge rien de payant.
 */
export default async function RadarPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale)
  const t = getTranslator(locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const profile = await getProfile(user.id)
  if (profile === null || profile.completedAt === null) redirect(`/${locale}/objectif`)

  const [wallet, entitlements, open] = await Promise.all([
    getWallet(user.id),
    getEntitlements(user.id),
    isEnabled('radar'),
  ])
  const granted = entitlements.granted.includes(RADAR_FEATURE)
  const lock = entitlements.locked.find((entry) => entry.feature.id === RADAR_FEATURE)

  const shell = {
    locale,
    userName: user.name ?? user.email,
    credits: wallet.balance,
    isAdmin: user.role === 'ADMIN',
    screen: 'radar',
  }

  if (!open || !granted) {
    return (
      <Shell {...shell}>
        <div className="mx-auto w-full max-w-3xl">
          <h1 className="mb-1 text-2xl font-semibold">{t('radar.title')}</h1>
          <p className="mb-7 text-[var(--color-ink-soft)]">{t('radar.subtitle')}</p>
          <Card>
            <p className="font-medium">{open ? t('radar.notIncluded') : t('radar.closed')}</p>
            {open && lock?.availableWith != null ? (
              <p className="mt-2 text-[var(--color-ink-soft)]">
                {t('radar.availableWith', { plan: lock.availableWith })}
              </p>
            ) : null}
            {open ? (
              <a href={`/${locale}#tarifs`} className="mt-4 inline-block text-sm font-medium">
                {t('radar.seeOffers')}
              </a>
            ) : null}
          </Card>
        </div>
      </Shell>
    )
  }

  const [overview, v2] = await Promise.all([getRadarOverview(user.id), isEnabled('radarV2')])
  // La V2 n'est lue que si elle est ouverte : rien de plus n'est chargé sinon.
  const [alerts, projects] = v2
    ? await Promise.all([readRadarAlerts(user.id), listProjects(user.id)])
    : [false, []]

  return (
    <Shell {...shell}>
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="mb-1 text-2xl font-semibold">{t('radar.title')}</h1>
        <p className="mb-7 text-[var(--color-ink-soft)]">{t('radar.subtitle')}</p>
        <RadarBoard
          locale={locale}
          initialOpportunities={overview.opportunities}
          initialQuota={{ ...overview.quota, resetsAt: overview.quota.resetsAt.toISOString() }}
          runs={overview.runs}
          aiAvailable={overview.aiAvailable}
          missingPrecisions={overview.missingPrecisions}
          searchCredits={RADAR_ESTIMATED_CREDITS}
          compareCredits={COMPARE_ESTIMATED_CREDITS}
          credits={wallet.balance}
          v2={v2}
          alerts={alerts}
          projects={projects.map((project) => ({ id: project.id, name: project.name }))}
          signalSources={v2 ? signalSourcesStatus() : []}
        />
      </div>
    </Shell>
  )
}
