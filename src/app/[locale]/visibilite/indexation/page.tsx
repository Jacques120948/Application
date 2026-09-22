import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { readDashboard } from '@/server/audit/service'
import { lireIndexation, PAGES_INSPECTEES } from '@/server/audit/indexation'
import { Shell } from '@/components/studio/Shell'
import { Indexation } from '@/components/studio/Indexation'

/**
 * L'écran d'indexation.
 *
 * L'état des lieux est gratuit et ne demande rien à Google : Evoliia connaît les pages du
 * site parce qu'elle les a explorées, et les pages affichées parce qu'elle lit déjà les
 * chiffres de recherche. L'écart se calcule. C'est l'inspection page par page qui coûte un
 * quota, et elle se demande.
 */
export const maxDuration = 60

export default async function IndexationPage({
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
  const [credits, tableau] = await Promise.all([
    availableCredits(user.id),
    readDashboard(user.id, demande.siteId),
  ])
  if (tableau === null) redirect(`/${locale}/visibilite`)

  const vue = await lireIndexation(user.id, tableau.site.id)

  return (
    <Shell
      locale={locale}
      userName={user.name}
      credits={credits}
      isAdmin={user.role === 'ADMIN'}
      screen="visibilite"
      menu="indexation"
      siteId={tableau.site.id}
    >
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        <a
          href={`/${locale}/visibilite?siteId=${tableau.site.id}`}
          className="text-sm text-[var(--color-ink-soft)] no-underline"
        >
          ← Votre visibilité
        </a>
        <h1 className="mt-4 mb-0 text-2xl font-semibold tracking-tight">Vos pages dans Google</h1>
        <p className="mt-2 mb-8 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Une page absente de l’index de Google ne se classe nulle part, quel que soit son
          contenu — et rien sur {vue.site.host} ne le montre. Voici l’écart entre ce
          qu’Evoliia a relevé et ce que Google affiche.
        </p>

        <Indexation
          siteId={tableau.site.id}
          locale={locale}
          suspectes={vue.suspectes}
          explorees={vue.explorees}
          affichees={vue.affichees}
          jours={vue.jours}
          propriete={vue.propriete}
          maximum={PAGES_INSPECTEES}
        />
      </div>
    </Shell>
  )
}
