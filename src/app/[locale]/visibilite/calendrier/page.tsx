import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { readDashboard } from '@/server/audit/service'
import {
  grilleDuMois,
  lireCalendrier,
  moisDisponibles,
  type CaseCalendrier,
} from '@/server/audit/calendrier'
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
 * C'est une grille de mois, et non une liste datée. Ce fut une liste, et la différence
 * n'est pas décorative : un plan de rédaction sert à voir les trous — la semaine sans rien,
 * les trois articles collés, le mois où l'on s'est arrêté. Une liste montre ce qu'elle
 * contient ; une grille montre aussi ce qu'elle ne contient pas, et c'est précisément ce
 * qu'on vient y chercher.
 *
 * Ce qui a été écrit et ce qui est prévu occupent les mêmes cases, sous deux apparences.
 * Les séparer en deux écrans ferait perdre la seule chose qu'un calendrier apporte : la
 * continuité entre ce qu'on a fait et ce qu'on va faire.
 *
 * Rien n'est enregistré du côté des sujets à venir : le plan se recalcule à chaque
 * ouverture, sur les chiffres du moment. Un calendrier figé vieillirait en silence, et
 * proposerait dans six semaines des sujets tirés d'une demande qui aura bougé.
 */
export const maxDuration = 60

/**
 * Les rythmes proposés, et ce que chacun couvre.
 *
 * Un plan doit tenir sur la durée qu'on lui donne : proposer huit semaines à quelqu'un qui
 * publie une fois par mois, c'est un plan abandonné à la troisième semaine. Le choix voyage
 * dans l'adresse, comme le mois affiché — il se met en favori et survit au rafraîchissement.
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

/** Les en-têtes de colonnes. La semaine commence le lundi, comme on la lit ici. */
const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']

/**
 * Le rythme que la rédaction automatique suit réellement, s'il figure dans la liste.
 *
 * Il décide de ce que l'écran montre par défaut, et c'est la correction d'un vrai défaut :
 * le bandeau annonçait « Milo écrit 3 articles par semaine » au-dessus d'un plan calculé
 * pour un par semaine, parce que l'un venait des réglages et l'autre d'une valeur par
 * défaut. Deux rythmes contradictoires sur le même écran ne font pas hésiter entre les
 * deux — ils font douter des deux.
 */
function rythmeDeLAutomatisation(
  redaction: { active: boolean; parPeriode: number; periode: string } | null,
): CleRythme | null {
  if (redaction === null || !redaction.active) return null
  const cle = `${redaction.parPeriode}-${redaction.periode}`
  return cle in RYTHMES ? (cle as CleRythme) : null
}

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

/** « 2026-10 » → le premier du mois. Une valeur inattendue rend `null`. */
function moisDeLaCle(cle: string | undefined): Date | null {
  if (cle === undefined || !/^\d{4}-\d{2}$/u.test(cle)) return null
  const [annee, mois] = cle.split('-').map(Number) as [number, number]
  if (mois < 1 || mois > 12) return null
  return new Date(annee, mois - 1, 1)
}

function cleDuMois(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function ChoixDuRythme({ actuel, base }: { actuel: CleRythme; base: string }) {
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Rythme de publication">
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

/**
 * Une case du mois.
 *
 * Les jours des mois voisins sont montrés mais éteints : une grille à trous se lit mal, et
 * un lundi qui commence au milieu de la ligne fait chercher où l'on est. Le jour même
 * porte une pastille — sur un calendrier, savoir où l'on se trouve est la première chose
 * qu'on demande.
 */
function Case({
  case_,
  locale,
  siteId,
  aujourdhui,
}: {
  case_: CaseCalendrier
  locale: string
  siteId: string
  aujourdhui: boolean
}) {
  const vide = case_.ecrits.length === 0 && case_.prevus.length === 0
  return (
    <td
      className={`h-28 w-[14.28%] align-top border border-[var(--color-line)] p-1.5 ${
        case_.dansLeMois ? 'bg-[var(--color-surface)]' : 'bg-[var(--color-canvas)]'
      }`}
    >
      <div className="mb-1 flex items-center justify-between">
        <span
          className={
            aujourdhui
              ? 'flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-ink)] text-xs font-semibold text-[var(--color-surface)]'
              : `text-xs ${case_.dansLeMois ? 'text-[var(--color-ink-soft)]' : 'text-[var(--color-ink-faint)]'}`
          }
        >
          {case_.date.getDate()}
        </span>
      </div>

      {vide ? null : (
        <div className="grid gap-1">
          {case_.ecrits.map((article) => (
            <div
              key={article.id}
              className="rounded-[var(--radius-control)] bg-[var(--color-canvas)] p-1.5"
              title={article.titre}
            >
              <span className="block rounded-[var(--radius-pill)] bg-[var(--color-brand-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-brand-strong)]">
                {article.depose ? 'Déposé' : 'Écrit'}
              </span>
              <span className="mt-1 block text-[11px] leading-tight text-[var(--color-ink-soft)]">
                {article.titre}
              </span>
            </div>
          ))}

          {case_.prevus.map((creneau) => (
            /*
              Un lien sur toute la vignette, et non un bouton en dessous : sur une case de
              cette taille, un bouton mangerait la place du sujet — or c'est le sujet qu'on
              vient lire. Le titre complet reste accessible au survol et aux lecteurs
              d'écran, parce que la case le coupe.
            */
            <a
              key={creneau.requete}
              href={`/${locale}/visibilite/articles?siteId=${siteId}&sujet=${encodeURIComponent(creneau.requete)}${creneau.langue === null ? '' : `&langue=${creneau.langue}`}`}
              title={`${creneau.requete} — ${creneau.pourquoi}`}
              className="block rounded-[var(--radius-control)] border border-[var(--color-brand)]/30 bg-[var(--color-surface)] p-1.5 no-underline hover:bg-[var(--color-brand-soft)]"
            >
              <span className="block rounded-[var(--radius-pill)] bg-[var(--color-brand)] px-1.5 py-0.5 text-[10px] font-medium text-white">
                À écrire
              </span>
              <span className="mt-1 block text-[11px] leading-tight text-[var(--color-ink)]">
                {creneau.requete}
              </span>
              <span className="mt-0.5 block text-[10px] leading-tight text-[var(--color-ink-faint)]">
                {INTENTIONS[creneau.intention]}
                {creneau.langue === null ? '' : ` · ${nomDeLaLangue(creneau.langue, locale)}`}
              </span>
            </a>
          ))}
        </div>
      )}
    </td>
  )
}

export default async function CalendrierPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ siteId?: string; rythme?: string; mois?: string }>
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
   * Une première lecture, sans plan, pour connaître le rythme de la rédaction automatique.
   * Elle ne coûte que deux requêtes en base — le plan, lui, n'est calculé qu'une fois,
   * plus bas, avec le bon rythme.
   */
  const reglages = (
    await lireCalendrier(user.id, tableau.site.id, {
      parPeriode: 0,
      periode: 'semaine',
      periodes: 0,
    })
  ).redaction
  const automatique = rythmeDeLAutomatisation(reglages)

  /*
   * Le rythme vient de l'adresse, sinon de la rédaction automatique, sinon du défaut. Une
   * valeur inattendue retombe sur le défaut plutôt que de faire échouer un écran qu'on
   * venait consulter.
   */
  const cle: CleRythme =
    demande.rythme !== undefined && demande.rythme in RYTHMES
      ? (demande.rythme as CleRythme)
      : (automatique ?? RYTHME_PAR_DEFAUT)
  const rythme = RYTHMES[cle]

  const vue = await lireCalendrier(user.id, tableau.site.id, rythme)

  const maintenant = new Date()
  const mois = moisDeLaCle(demande.mois) ?? new Date(maintenant.getFullYear(), maintenant.getMonth(), 1)
  const grille = grilleDuMois(mois, vue.ecrits, vue.creneaux)

  /* Les flèches ne mènent qu'à des mois qui contiennent quelque chose. */
  const disponibles = moisDisponibles(vue.ecrits, vue.creneaux, maintenant)
  const ici = disponibles.indexOf(cleDuMois(mois))
  const precedent = ici > 0 ? disponibles[ici - 1] : undefined
  const suivant = ici >= 0 && ici < disponibles.length - 1 ? disponibles[ici + 1] : undefined

  const base = `/${locale}/visibilite/calendrier?siteId=${tableau.site.id}`
  const lien = (moisCle: string): string => `${base}&rythme=${cle}&mois=${moisCle}`

  const prevus = vue.creneaux.length
  const ecrits = vue.ecrits.length

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
      <div className="mx-auto w-full max-w-6xl px-5 py-10">
        <a
          href={`/${locale}/visibilite?siteId=${tableau.site.id}`}
          className="text-sm text-[var(--color-ink-soft)] no-underline"
        >
          ← Votre visibilité
        </a>
        <h1 className="mt-4 mb-0 text-2xl font-semibold tracking-tight">Quoi écrire, et quand</h1>
        <p className="mt-2 mb-6 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          {prevus === 0 ? 'Aucun sujet' : `${prevus} sujet${prevus > 1 ? 's' : ''}`} à venir
          {ecrits === 0 ? '' : `, ${ecrits} article${ecrits > 1 ? 's' : ''} déjà écrit${ecrits > 1 ? 's' : ''}`}
          , choisis dans ce que les gens ont réellement tapé pour voir {vue.site.host} ces{' '}
          {vue.jours} derniers jours. Les recherches où vous êtes le plus près de la première
          page passent devant.
        </p>

        {vue.redaction?.active === true ? (
          <p className="mt-0 mb-6 rounded-[var(--radius-control)] bg-[var(--color-brand-soft)] px-3 py-2 text-xs leading-relaxed text-[var(--color-brand-strong)]">
            Milo écrit {vue.redaction.parPeriode} article
            {vue.redaction.parPeriode > 1 ? 's' : ''} par {vue.redaction.periode} sans que
            vous le demandiez, en partant du haut de ce plan.
            {vue.redaction.dernier === null
              ? ' Aucun n’a encore été écrit de cette façon.'
              : ` Le dernier date du ${jour(vue.redaction.dernier, locale)}.`}
            {automatique !== null && cle !== automatique ? (
              /*
                Le cas qui faisait douter de tout l'écran : un bandeau annonçant trois
                articles par semaine au-dessus d'un plan qui en montrait un. La grille suit
                désormais la rédaction automatique par défaut ; si elle en dévie, c'est que
                la personne l'a demandé, et l'écran le dit au lieu de laisser deviner.
              */
              <>
                {' '}
                <strong>
                  Vous regardez ici un autre rythme — {RYTHMES[cle].label.toLowerCase()} —
                  pour voir ce que cela donnerait.
                </strong>
              </>
            ) : null}
          </p>
        ) : null}

        {/* ── La barre du mois ── */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {precedent === undefined ? (
              <span className="cursor-not-allowed rounded-[var(--radius-control)] border border-[var(--color-line)] px-2.5 py-1 text-sm text-[var(--color-ink-faint)]">
                ←
              </span>
            ) : (
              <a
                href={lien(precedent)}
                aria-label="Mois précédent"
                className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-2.5 py-1 text-sm no-underline"
              >
                ←
              </a>
            )}
            <span className="min-w-44 text-base font-semibold">
              {mois.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
            </span>
            {suivant === undefined ? (
              <span className="cursor-not-allowed rounded-[var(--radius-control)] border border-[var(--color-line)] px-2.5 py-1 text-sm text-[var(--color-ink-faint)]">
                →
              </span>
            ) : (
              <a
                href={lien(suivant)}
                aria-label="Mois suivant"
                className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-2.5 py-1 text-sm no-underline"
              >
                →
              </a>
            )}
          </div>
          <ChoixDuRythme actuel={cle} base={base} />
        </div>

        {vue.propriete === null ? (
          <div className="mb-4 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
            <p className="m-0 text-sm leading-relaxed">
              Google Search Console n’est pas relié pour ce site : aucun sujet ne peut être
              proposé. Sans lui, un calendrier ne serait qu’une liste de sujets devinés — et
              deviner, c’est exactement ce que ce produit refuse de faire.
            </p>
            <LinkButton href={`/${locale}/connexions`} variant="secondary" className="mt-3">
              Connecter Search Console
            </LinkButton>
          </div>
        ) : vue.creneaux.length === 0 ? (
          <p className="mb-4 rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-3 py-2 text-xs leading-relaxed text-[var(--color-ink-soft)]">
            Aucun sujet à proposer sur cette période. Soit vos recherches sortent déjà en
            première page — et c’est alors le titre et la description qui se travaillent, pas
            un article de plus — soit la demande mesurée est encore trop mince.
          </p>
        ) : null}

        {/* ── La grille ── */}
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-line)]">
          <table className="w-full min-w-[46rem] border-collapse">
            <thead>
              <tr>
                {JOURS.map((nom) => (
                  <th
                    key={nom}
                    scope="col"
                    className="border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1.5 text-xs font-medium tracking-wide text-[var(--color-ink-faint)] uppercase"
                  >
                    {nom}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grille.map((semaine) => (
                <tr key={semaine[0]!.date.toISOString()}>
                  {semaine.map((case_) => (
                    <Case
                      key={case_.date.toISOString()}
                      case_={case_}
                      locale={locale}
                      siteId={tableau.site.id}
                      aujourdhui={
                        case_.date.getFullYear() === maintenant.getFullYear() &&
                        case_.date.getMonth() === maintenant.getMonth() &&
                        case_.date.getDate() === maintenant.getDate()
                      }
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-5 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
          {vue.dejaEcrits === 0
            ? null
            : `${vue.dejaEcrits} sujet${vue.dejaEcrits > 1 ? 's ont' : ' a'} été écarté${vue.dejaEcrits > 1 ? 's' : ''} : vous avez déjà un article dessus. `}
          Cliquez sur un sujet pour le faire écrire, ou passez par{' '}
          <a href={`/${locale}/visibilite/articles?siteId=${tableau.site.id}`}>l’écran de Milo</a>{' '}
          pour en demander un sur un sujet à vous. Les sujets à venir se recalculent à
          chaque ouverture, sur les chiffres du moment. Aucun gain n’est annoncé ici : un
          article bien écrit rend une page reprenable, il ne garantit ni position ni visite —
          personne ne peut le promettre.
        </p>
      </div>
    </Shell>
  )
}
