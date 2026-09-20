import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { readDashboard } from '@/server/audit/service'
import { estimerArticle } from '@/server/audit/articles'
import { lireReglages } from '@/server/audit/automatisation'
import { hasConnection } from '@/server/integrations/service'
import { Shell } from '@/components/studio/Shell'
import { Automatisation } from '@/components/studio/Automatisation'

/**
 * Ce qu'on laisse tourner seul.
 *
 * Un écran à part, et non une ligne de réglage cachée sous un autre : allumer une dépense
 * récurrente est une décision, et une décision se prend sur un écran qui dit ce qu'elle
 * engage. Les fonctions gratuites et celle qui coûte sont séparées visuellement pour la
 * même raison — cocher « tout » ne doit pas pouvoir allumer la dépense par inadvertance.
 */
export default async function AutomatisationPage({
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

  const [reglages, cout, boutique, recherche] = await Promise.all([
    lireReglages(user.id, tableau.site.id),
    estimerArticle(),
    hasConnection(user.id, 'shopify'),
    hasConnection(user.id, 'google-search-console'),
  ])

  return (
    <Shell
      locale={locale}
      userName={user.name}
      credits={credits}
      isAdmin={user.role === 'ADMIN'}
      screen="visibilite"
    >
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        <a
          href={`/${locale}/visibilite?siteId=${tableau.site.id}`}
          className="text-sm text-[var(--color-ink-soft)] no-underline"
        >
          ← Votre visibilité
        </a>
        <h1 className="mt-4 mb-0 text-2xl font-semibold tracking-tight">
          Ce qui tourne tout seul
        </h1>
        <p className="mt-2 mb-8 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Rien n’est allumé tant que vous ne l’allumez pas, pour {tableau.site.host}. Ce que
          vous choisissez ici passe chaque nuit, vers 3 heures.
        </p>

        <Automatisation
          siteId={tableau.site.id}
          initiaux={{
            indexation: reglages.indexation,
            releve: reglages.releve,
            redaction: reglages.redaction,
            depot: reglages.depot,
            blogId: reglages.blogId,
            parPeriode: reglages.parPeriode,
            periode: reglages.periode,
          }}
          cout={cout}
          boutiqueReliee={boutique}
          rechercheReliee={recherche}
        />
      </div>
    </Shell>
  )
}
