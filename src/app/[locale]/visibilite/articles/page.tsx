import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { estimerArticle, listArticles, listManquesDeContenu } from '@/server/audit/articles'
import { readDashboard } from '@/server/audit/service'
import { Shell } from '@/components/studio/Shell'
import { ArticlesRediges } from '@/components/studio/ArticlesRediges'

/**
 * L'écran des articles.
 *
 * Une page à part du tableau de bord, et non un bloc de plus : on n'y vient pas pour la même
 * raison. Le tableau de bord répond à « où en suis-je », et se lit en dix secondes ; écrire
 * un article est une décision qui coûte des crédits et se relit ensuite longuement. Les
 * empiler aurait allongé l'écran que tout le monde ouvre pour servir celui qu'on ouvre
 * parfois.
 */
export default async function ArticlesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ siteId?: string }>
}) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  /*
   * L'identifiant de site demandé n'ouvre aucun droit : `readDashboard` ne le cherche que
   * parmi les sites déjà filtrés par la portée de l'utilisateur, et retombe sur le plus
   * récent quand il n'y correspond rien.
   */
  const demande = await searchParams
  const [credits, tableau] = await Promise.all([
    availableCredits(user.id),
    readDashboard(user.id, demande.siteId),
  ])

  if (tableau === null) redirect(`/${locale}/visibilite`)

  const [manques, articles, cout] = await Promise.all([
    listManquesDeContenu(user.id, tableau.site.id),
    listArticles(user.id, tableau.site.id),
    estimerArticle(),
  ])

  return (
    <Shell locale={locale} userName={user.name} credits={credits} screen="visibilite">
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        <a
          href={`/${locale}/visibilite?siteId=${tableau.site.id}`}
          className="text-sm text-[var(--color-ink-soft)] no-underline"
        >
          ← Votre visibilité
        </a>
        <h1 className="mt-4 mb-0 text-2xl font-semibold tracking-tight">Articles</h1>
        <p className="mt-2 mb-8 text-sm text-[var(--color-ink-soft)]">
          Milo écrit un article de fond à partir de ce que l’analyse relève sur votre contenu.
        </p>

        <ArticlesRediges
          siteId={tableau.site.id}
          host={tableau.site.host}
          locale={locale}
          manques={manques}
          articles={articles.map((article) => ({
            ...article,
            createdAt: article.createdAt.toISOString(),
          }))}
          cout={cout}
        />
      </div>
    </Shell>
  )
}
