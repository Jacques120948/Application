import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { readDashboard } from '@/server/audit/service'
import { lireCalendrier, type Creneau } from '@/server/audit/calendrier'
import { Shell } from '@/components/studio/Shell'

/**
 * Le calendrier de rédaction.
 *
 * Écrire un article par semaine est un conseil que tout le monde donne ; sur quoi l'écrire
 * est la seule question qui compte. Cet écran y répond avec les chiffres de Google sur les
 * pages de la personne, et il n'annonce aucun gain — ce qui est mesuré est montré, le reste
 * se tait.
 *
 * Rien n'est enregistré : le plan se recalcule à chaque ouverture, sur les chiffres du
 * moment. Un calendrier figé vieillirait en silence, et proposerait dans six semaines des
 * sujets tirés d'une demande qui aura bougé.
 */
export const maxDuration = 60

/** Ce qu'on propose. Un article par semaine sur deux mois : un rythme qu'on tient. */
const PAR_SEMAINE = 1
const SEMAINES = 8

function jour(date: Date, locale: string): string {
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'long' })
}

function Ligne({ creneau, locale, siteId }: { creneau: Creneau; locale: string; siteId: string }) {
  return (
    <li className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="m-0 text-sm font-medium">« {creneau.requete} »</p>
        <p className="m-0 text-xs text-[var(--color-ink-faint)]">
          semaine du {jour(creneau.date, locale)}
        </p>
      </div>
      <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
        {creneau.pourquoi}
      </p>
      <a
        href={`/${locale}/visibilite/articles?siteId=${siteId}&sujet=${encodeURIComponent(creneau.requete)}`}
        className="mt-2 inline-block text-xs text-[var(--color-ink-soft)]"
      >
        Faire écrire cet article →
      </a>
    </li>
  )
}

export default async function CalendrierPage({
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

  const vue = await lireCalendrier(user.id, tableau.site.id, {
    parSemaine: PAR_SEMAINE,
    semaines: SEMAINES,
  })

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
        <h1 className="mt-4 mb-0 text-2xl font-semibold tracking-tight">Quoi écrire, et quand</h1>
        <p className="mt-2 mb-8 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Un sujet par semaine, choisi dans ce que les gens ont réellement tapé pour voir{' '}
          {vue.site.host} ces {vue.jours} derniers jours. Les recherches où vous êtes le plus
          près de la première page passent devant.
        </p>

        {vue.propriete === null ? (
          <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
            <p className="m-0 text-sm leading-relaxed">
              Google Search Console n’est pas relié pour ce site. Sans lui, un calendrier ne
              serait qu’une liste de sujets devinés — et deviner, c’est exactement ce que ce
              produit refuse de faire.
            </p>
            <a
              href={`/${locale}/connexions`}
              className="mt-3 inline-block text-sm text-[var(--color-ink-soft)]"
            >
              Connecter Search Console
            </a>
          </div>
        ) : vue.creneaux.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
            <p className="m-0 text-sm leading-relaxed">
              Aucun sujet à proposer sur cette période. Soit vos recherches sortent déjà en
              première page — et c’est alors le titre et la description qui se travaillent,
              pas un article de plus — soit la demande mesurée est encore trop mince.
            </p>
          </div>
        ) : (
          <>
            <ul className="m-0 grid list-none gap-3 p-0">
              {vue.creneaux.map((creneau) => (
                <Ligne
                  key={creneau.requete}
                  creneau={creneau}
                  locale={locale}
                  siteId={tableau.site.id}
                />
              ))}
            </ul>

            <p className="mt-6 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
              {vue.dejaEcrits === 0
                ? null
                : `${vue.dejaEcrits} sujet${vue.dejaEcrits > 1 ? 's ont' : ' a'} été écarté${vue.dejaEcrits > 1 ? 's' : ''} : vous avez déjà un article dessus. `}
              Ce plan se recalcule à chaque ouverture, sur les chiffres du moment. Aucun gain
              n’est annoncé ici : un article bien écrit rend une page reprenable, il ne
              garantit ni position ni visite — personne ne peut le promettre.
            </p>
          </>
        )}
      </div>
    </Shell>
  )
}
