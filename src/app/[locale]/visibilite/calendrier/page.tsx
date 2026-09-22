import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { readDashboard } from '@/server/audit/service'
import { lireCalendrier, type Creneau } from '@/server/audit/calendrier'
import { INTENTIONS } from '@/server/audit/intentions'
import { Shell } from '@/components/studio/Shell'
import { LinkButton } from '@/components/ui'

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

/**
 * Les rythmes proposés, et ce que chacun couvre.
 *
 * Un plan doit tenir sur la durée qu'on lui donne : proposer huit semaines à quelqu'un qui
 * publie une fois par mois, c'est un plan abandonné à la troisième semaine. Le choix voyage
 * dans l'adresse, comme le filtre par pays — il se met en favori et survit au
 * rafraîchissement.
 */
const RYTHMES = {
  '1-semaine': { parPeriode: 1, periode: 'semaine' as const, periodes: 8, label: '1 par semaine' },
  '2-semaine': { parPeriode: 2, periode: 'semaine' as const, periodes: 6, label: '2 par semaine' },
  '3-semaine': { parPeriode: 3, periode: 'semaine' as const, periodes: 4, label: '3 par semaine' },
  '1-mois': { parPeriode: 1, periode: 'mois' as const, periodes: 6, label: '1 par mois' },
  '2-mois': { parPeriode: 2, periode: 'mois' as const, periodes: 6, label: '2 par mois' },
}

type CleRythme = keyof typeof RYTHMES

const RYTHME_PAR_DEFAUT: CleRythme = '1-semaine'

function jour(date: Date, locale: string): string {
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'long' })
}

/** Le nom d'une langue, dans celle de la personne. Le code brut si le système ne le connaît pas. */
function nomDeLaLangue(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

function ChoixDuRythme({ actuel, locale, siteId }: { actuel: CleRythme; locale: string; siteId: string }) {
  const base = `/${locale}/visibilite/calendrier?siteId=${siteId}`
  return (
    <nav className="mb-6 flex flex-wrap gap-2" aria-label="Rythme de publication">
      {(Object.keys(RYTHMES) as CleRythme[]).map((cle) => {
        const actif = cle === actuel
        return (
          <a
            key={cle}
            href={`${base}&rythme=${cle}`}
            aria-current={actif ? 'true' : undefined}
            className={`rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs no-underline ${
              actif
                ? 'border-transparent bg-[var(--color-ink)] text-[var(--color-surface)]'
                : 'border-[var(--color-line)] text-[var(--color-ink-soft)]'
            }`}
          >
            {RYTHMES[cle].label}
          </a>
        )
      })}
    </nav>
  )
}

function Ligne({ creneau, locale, siteId }: { creneau: Creneau; locale: string; siteId: string }) {
  return (
    <li className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="m-0 text-sm font-medium">
          « {creneau.requete} »
          {/*
            L'intention, avant le clic. Elle décide de la forme de l'article — un guide, une
            comparaison, une page qui mène à une fiche — et elle est déduite des mots, pas
            rendue par Google. La montrer permet de la contester : qui la trouve fausse
            écrit son propre sujet.
          */}
          <span className="ml-2 rounded-[var(--radius-pill)] bg-[var(--color-canvas)] px-2 py-0.5 text-xs font-normal text-[var(--color-ink-soft)]">
            {INTENTIONS[creneau.intention]}
          </span>
          {creneau.langue === null ? null : (
            <span className="ml-2 rounded-[var(--radius-pill)] bg-[var(--color-canvas)] px-2 py-0.5 text-xs font-normal text-[var(--color-ink-soft)]">
              {nomDeLaLangue(creneau.langue, locale)}
            </span>
          )}
        </p>
        <p className="m-0 text-xs text-[var(--color-ink-faint)]">
          semaine du {jour(creneau.date, locale)}
        </p>
      </div>
      <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
        {creneau.pourquoi}
      </p>
      {/*
        Un bouton, et non un lien discret : c'est l'action de l'écran, et elle était
        jusqu'ici du texte gris de la même taille et de la même couleur que la phrase
        au-dessus. Rien ne disait qu'on pouvait cliquer, et personne ne clique sur ce
        qui ne se présente pas comme cliquable.
      */}
      <LinkButton
        href={`/${locale}/visibilite/articles?siteId=${siteId}&sujet=${encodeURIComponent(creneau.requete)}${creneau.langue === null ? '' : `&langue=${creneau.langue}`}`}
        variant="secondary"
        size="medium"
        className="mt-3"
      >
        Faire écrire cet article
      </LinkButton>
    </li>
  )
}

export default async function CalendrierPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ siteId?: string; rythme?: string }>
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

  /*
   * Le rythme vient de l'adresse : il n'ouvre aucun droit, et une valeur inattendue retombe
   * sur celui par défaut plutôt que de faire échouer un écran qu'on venait consulter.
   */
  const cle: CleRythme =
    demande.rythme !== undefined && demande.rythme in RYTHMES
      ? (demande.rythme as CleRythme)
      : RYTHME_PAR_DEFAUT
  const rythme = RYTHMES[cle]

  const vue = await lireCalendrier(user.id, tableau.site.id, rythme)

  return (
    <Shell
      locale={locale}
      userName={user.name}
      credits={credits}
      isAdmin={user.role === 'ADMIN'}
      screen="visibilite"
      menu="calendrier"
      siteId={tableau.site.id}
      sites={[tableau.site, ...tableau.autresSites]}
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
          {rythme.label}, choisi dans ce que les gens ont réellement tapé pour voir{' '}
          {vue.site.host} ces {vue.jours} derniers jours. Les recherches où vous êtes le plus
          près de la première page passent devant.
        </p>

        <ChoixDuRythme actuel={cle} locale={locale} siteId={tableau.site.id} />

        {vue.propriete === null ? (
          <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
            <p className="m-0 text-sm leading-relaxed">
              Google Search Console n’est pas relié pour ce site. Sans lui, un calendrier ne
              serait qu’une liste de sujets devinés — et deviner, c’est exactement ce que ce
              produit refuse de faire.
            </p>
            <LinkButton href={`/${locale}/connexions`} variant="secondary" className="mt-3">
              Connecter Search Console
            </LinkButton>
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
