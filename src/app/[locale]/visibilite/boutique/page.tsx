import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { readBoutique } from '@/server/commerce/boutique'
import { Shell } from '@/components/studio/Shell'
import { LinkButton } from '@/components/ui'
import { BoutiqueBoard } from '@/components/studio/BoutiqueBoard'

/**
 * L'écran de la boutique.
 *
 * Il ne tombe jamais : une boutique injoignable, des identifiants révoqués ou une connexion absente
 * sont des états ordinaires, pas des pannes. Chacun a sa phrase et son geste suivant, parce
 * qu'un écran vide sans explication devant une connexion qu'on vient de payer est la
 * meilleure façon de faire douter de tout le reste.
 */
/**
 * Le temps que l'hébergeur doit accorder à cet écran.
 *
 * Une boutique de mille fiches demande une vingtaine d'allers-retours à Shopify, qui limite
 * son débit. Sans ce réglage, la plateforme coupe à dix ou quinze secondes par défaut et
 * l'écran meurt en plein travail, sur un message qui ne dit rien à personne.
 */
export const maxDuration = 60

export default async function BoutiquePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const credits = await availableCredits(user.id)

  const lecture = await readBoutique(user.id)
    .then((boutique) => ({ boutique, erreur: null as string | null }))
    .catch((error: unknown) => ({
      boutique: null,
      erreur: error instanceof Error ? error.message : 'Shopify n’a pas répondu.',
    }))

  return (
    <Shell locale={locale} userName={user.name} credits={credits} isAdmin={user.role === 'ADMIN'} screen="visibilite">
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        <a
          href={`/${locale}/visibilite`}
          className="text-sm text-[var(--color-ink-soft)] no-underline"
        >
          ← Votre visibilité
        </a>
        <h1 className="mt-4 mb-0 text-2xl font-semibold tracking-tight">Votre boutique</h1>
        <p className="mt-2 mb-8 text-sm text-[var(--color-ink-soft)]">
          Ce que vos fiches produits et vos articles contiennent réellement, tel que vous
          l’avez saisi dans Shopify.
        </p>

        {lecture.erreur !== null ? (
          <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
            <p className="m-0 text-sm">{lecture.erreur}</p>
            <LinkButton href={`/${locale}/connexions`} variant="secondary" className="mt-3">
              Revoir mes connexions
            </LinkButton>
          </div>
        ) : lecture.boutique === null ? (
          <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
            <p className="m-0 text-sm leading-relaxed">
              Aucune boutique Shopify n’est connectée. En la reliant, Evoliia lit vos fiches
              produits et vos articles pour vous montrer ce qui leur manque — en lecture
              seule, elle ne peut rien y écrire.
            </p>
            <LinkButton href={`/${locale}/connexions`} variant="secondary" className="mt-3">
              Connecter Shopify
            </LinkButton>
          </div>
        ) : (
          <BoutiqueBoard
            boutique={lecture.boutique.boutique}
            produits={lecture.boutique.produits}
            articles={lecture.boutique.articles}
            tronque={lecture.boutique.tronque}
            plafond={lecture.boutique.plafond}
          />
        )}
      </div>
    </Shell>
  )
}
