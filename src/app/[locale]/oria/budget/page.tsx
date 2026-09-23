import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { listSites, readDashboard } from '@/server/audit/service'
import {
  comparer,
  lireBudgets,
  lirePlateformes,
  observer,
  recommander,
  repartition,
  simuler,
} from '@/server/oria/budget'
import { Shell } from '@/components/studio/Shell'
import {
  DepenseReelleOria,
  OngletsOria,
  RecommandationBudgetOria,
  RepartitionOria,
  SimulationOria,
} from '@/components/studio/Oria'
import { BudgetsOria } from '@/components/studio/BudgetsOria'

/**
 * Le budget, vu par Oria.
 *
 * Tout est gratuit et tout est lecture : ce qui est déclaré, ce qui a été dépensé, ce que
 * cela a rapporté, et — quand les chiffres le permettent — une répartition suggérée et une
 * simulation en fourchette. Aucun budget n'est modifié depuis cet écran.
 */
export const maxDuration = 60

const VARIATIONS = [-50, -30, -20, -10, 10, 20, 30, 50, 100]

export default async function BudgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ siteId?: string; regie?: string; variation?: string }>
}) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const demande = await searchParams
  const [credits, sites, tableau, plateformes] = await Promise.all([
    availableCredits(user.id),
    listSites(user.id),
    readDashboard(user.id, demande.siteId).catch(() => null),
    lirePlateformes(user.id),
  ])
  // Les budgets vivent sur le site, comme les objectifs : sans site analysé, rien à régler.
  if (tableau === null) redirect(`/${locale}/oria`)
  const siteId = tableau.site.id

  const budgets = await lireBudgets(user.id, siteId)
  const comparaison = comparer(plateformes)
  const recommandation = recommander(budgets, plateformes, comparaison)
  const raison = !comparaison.possible
    ? comparaison.raison
    : comparaison.meilleure === null
      ? 'Les deux régies ont une rentabilité comparable sur la période : rien à déplacer.'
      : 'Déclarez vos budgets pour voir une répartition proposée.'

  // La simulation vient de l'adresse : elle se relit et se partage telle quelle.
  const variation = Number(demande.variation)
  const regie = plateformes.find((un) => un.poste === demande.regie)
  const choix =
    regie !== undefined && VARIATIONS.includes(variation) ? { poste: regie.poste, pourcent: variation } : null
  const simulation = regie !== undefined && choix !== null ? simuler(regie, choix.pourcent) : null

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
          <h1 className="m-0 text-2xl font-semibold tracking-tight">Budget</h1>
          <p className="mt-2 mb-4 text-sm leading-relaxed text-[var(--color-ink-soft)]">
            Ce que vous prévoyez, ce qui est dépensé, et ce que cela rapporte. Oria observe et
            suggère ; elle ne modifie aucun budget.
          </p>
          <OngletsOria courant="budget" locale={locale} siteId={siteId} />
        </div>

        <BudgetsOria siteId={siteId} initiaux={budgets} devise={plateformes[0]?.devise || 'CHF'} />
        <RepartitionOria parts={repartition(budgets)} />
        <DepenseReelleOria plateformes={plateformes} />
        <RecommandationBudgetOria
          observation={observer(budgets, comparaison)}
          recommandation={recommandation}
          raison={raison}
        />
        <SimulationOria
          action={`/${locale}/oria/budget`}
          siteId={siteId}
          plateformes={plateformes}
          choix={choix}
          resultat={simulation}
        />
      </div>
    </Shell>
  )
}
