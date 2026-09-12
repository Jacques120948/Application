import { redirect } from 'next/navigation'
import { getTranslator, resolveLocale, type MessageKey } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { getWallet } from '@/server/billing/credits'
import { getEntitlements } from '@/server/billing/entitlements'
import { getEffectivePlan } from '@/server/billing/plans'
import { LAUNCH_KIT_FEATURE } from '@/server/billing/features'
import { listProjects } from '@/server/projects/service'
import { getCreatorStats, getCreditHistory } from '@/server/business/stats'
import { listIdeas } from '@/server/business/ideas'
import { env } from '@/lib/env'
import { getCreatorOverview } from '@/server/business/overview'
import { OBJECTIVE_DISCLAIMER } from '@/server/business/economics'
import type { JourneyStep } from '@/server/business/journey'
import { Card, CardBody, LinkButton } from '@/components/ui'
import { Shell } from '@/components/studio/Shell'
import { ProjectCard } from '@/components/studio/ProjectCard'

/**
 * Tableau de bord.
 *
 * Il ne liste pas d'abord des applications : il répond d'abord à « où j'en suis et que
 * dois-je faire ensuite ». La liste des applications vient après, quand elle existe.
 *
 * La page suit la même grammaire visuelle que les applications construites par la
 * plateforme : un bandeau en dégradé, des cartes posées avec une ombre, une progression
 * lisible d'un coup d'œil. Un atelier qui aurait moins d'allure que ce qu'il produit
 * serait un mauvais argument.
 */
export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const [overview, projects, wallet, entitlements, plan] = await Promise.all([
    getCreatorOverview(user.id, locale),
    listProjects(user.id),
    getWallet(user.id),
    getEntitlements(user.id),
    getEffectivePlan(user.id),
  ])

  /*
   * Les chiffres, le registre de crédits et les idées en attente sont lus après la liste
   * des projets, dont ils dépendent. `listIdeas` échoue tant qu'aucun profil n'existe :
   * l'absence d'idées n'est pas une erreur, c'est simplement un parcours qui commence
   * autrement.
   */
  const [stats, credits, ideas] = await Promise.all([
    getCreatorStats(
      user.id,
      projects.map((project) => project.id),
    ),
    getCreditHistory(user.id),
    listIdeas(user.id).catch(() => []),
  ])
  const pendingIdeas = ideas.filter((idea) => idea.status === 'PROPOSED').slice(0, 3)
  const appUrl = env.appUrl.replace(/\/$/, '')

  /*
   * Rien du tout : on laisse choisir son chemin plutôt que d'imposer l'objectif.
   *
   * Un créateur qui arrive avec son idée en tête n'a pas à répondre d'abord à dix
   * questions sur son objectif de revenu. En revanche, celui qui a déjà construit quelque
   * chose sans objectif garde un tableau de bord utilisable : l'objectif lui est proposé,
   * pas imposé.
   */
  if (overview.objective === null && projects.length === 0) redirect(`/${locale}/demarrer`)

  const t = getTranslator(locale)
  const objective = overview.objective
  const next = overview.journey.next
  const firstName = (user.name ?? user.email).split(/[\s@]/)[0] ?? ''
  const published = projects.filter((project) => project.status === 'PUBLISHED')
  const canLaunch = entitlements.granted.includes(LAUNCH_KIT_FEATURE)
  /*
   * Place restante dans l'offre. Proposer « Nouveau projet » à qui a atteint sa limite
   * mènerait à un refus après trois écrans : mieux vaut dire tout de suite où ça bloque.
   */
  const slotsLeft = plan.allowBuild ? Math.max(0, plan.maxProjects - projects.length) : 0

  return (
    <Shell
      locale={locale}
      userName={user.name ?? user.email}
      credits={wallet.balance}
      isAdmin={user.role === 'ADMIN'}
      screen="dashboard"
    >
      <div className="grid gap-6">
        {/* ─────────────────────── Où j'en suis ──────────────────────────── */}
        <section
          className="relative isolate overflow-hidden rounded-[var(--radius-card)] px-6 py-8 text-white sm:px-8"
          style={{ background: 'var(--gradient-night)' }}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full opacity-25 blur-3xl"
            style={{ background: 'var(--gradient-brand)' }}
          />
          <div className="relative grid gap-8 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <p className="m-0 text-sm text-white/60">Bonjour {firstName}</p>
              {objective === null ? (
                <>
                  <h1 className="m-0 mt-2 text-balance text-2xl font-semibold sm:text-3xl">
                    Votre application existe. C’est l’essentiel.
                  </h1>
                  <p className="m-0 mt-3 max-w-xl text-white/70">
                    Définir un objectif de revenu vous dirait combien de clients il vous
                    faudrait, à quel prix, et ferait apparaître des idées adaptées à votre
                    profil.
                  </p>
                  <LinkButton href={`/${locale}/objectif`} className="mt-6">
                    Définir mon objectif
                  </LinkButton>
                </>
              ) : (
                <>
                  <h1 className="m-0 mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
                    {objective.monthlyGoalLabel}
                  </h1>
                  <p className="m-0 mt-1 text-white/60">
                    {objective.ideaTitle ?? 'Projet pas encore choisi'}
                  </p>
                  <div className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
                    <Figure
                      label="Clients nécessaires"
                      value={
                        objective.customersNeeded === null
                          ? '—'
                          : `environ ${objective.customersNeeded}`
                      }
                    />
                    <Figure
                      label="Opportunité"
                      value={
                        objective.opportunityScore === null
                          ? '—'
                          : `${objective.opportunityScore} sur 100`
                      }
                    />
                    <Figure label="Applications en ligne" value={String(published.length)} />
                  </div>
                </>
              )}
            </div>

            {objective === null ? null : <Progress value={overview.journey.progress} />}
          </div>

          {objective?.sentence != null ? (
            <p className="relative mt-8 border-t border-white/10 pt-5 text-sm text-white/70">
              {objective.sentence}{' '}
              <span className="text-white/40">{OBJECTIVE_DISCLAIMER}</span>
            </p>
          ) : null}
        </section>

        {/* ───────────────────── Que faire ensuite ────────────────────────── */}
        {next === null ? (
          <Card>
            <CardBody className="flex flex-wrap items-center gap-4">
              <div>
                <p className="m-0 text-sm font-medium text-[var(--color-positive)]">
                  Votre application est en ligne.
                </p>
                <p className="m-0 mt-1 text-sm text-[var(--color-ink-soft)]">
                  Il reste le plus difficile : la faire connaître.
                </p>
              </div>
              {canLaunch && published[0] !== undefined ? (
                <LinkButton
                  href={`/${locale}/projets/${published[0].id}/marketing`}
                  size="large"
                  className="ml-auto"
                >
                  Préparer mon lancement
                </LinkButton>
              ) : null}
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardBody className="flex flex-wrap items-center gap-5">
              <span
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-lg font-semibold text-white"
                style={{ background: 'var(--gradient-brand)' }}
                aria-hidden="true"
              >
                →
              </span>
              <div className="min-w-48 flex-1">
                <p className="m-0 text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
                  Prochaine étape
                </p>
                <p className="m-0 mt-0.5 text-lg font-semibold">{next.label}</p>
                <p className="m-0 mt-1 text-sm text-[var(--color-ink-soft)]">{next.why}</p>
              </div>
              <LinkButton href={next.href ?? `/${locale}/idees`} size="large" className="ml-auto">
                {next.action ?? 'Continuer'}
              </LinkButton>
            </CardBody>
          </Card>
        )}

        {/* ──────────────── Crédits et idées en attente ───────────────────── */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardBody>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="m-0 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
                  Vos crédits
                </h2>
                <span className="text-xs text-[var(--color-ink-soft)]">
                  Recharge le{' '}
                  {new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(wallet.resetsAt)}
                </span>
              </div>

              <div className="mt-3 flex items-baseline gap-3">
                <span className="text-3xl font-semibold">{wallet.balance}</span>
                <span className="text-sm text-[var(--color-ink-soft)]">
                  sur {plan.monthlyCredits} par mois
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-canvas)]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${plan.monthlyCredits === 0 ? 0 : Math.min(100, Math.round((wallet.balance / plan.monthlyCredits) * 100))}%`,
                    background: 'var(--gradient-brand)',
                  }}
                />
              </div>

              {credits.entries.length === 0 ? (
                <p className="mt-4 text-sm text-[var(--color-ink-soft)]">
                  Aucune dépense pour l’instant.
                </p>
              ) : (
                <>
                  <p className="mt-4 text-sm text-[var(--color-ink-soft)]">
                    {credits.spentInWindow} crédits dépensés sur {credits.windowDays} jours.
                  </p>
                  {/*
                    Le détail dit à quoi sont passés les crédits, pas seulement combien.
                    Un solde qui baisse sans explication ressemble à une fuite.
                  */}
                  <ul className="m-0 mt-3 grid list-none gap-2 p-0">
                    {credits.entries.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex min-w-0 items-baseline justify-between gap-3 text-sm"
                      >
                        <span className="truncate text-[var(--color-ink-soft)]">{entry.label}</span>
                        <span
                          className={
                            entry.delta < 0
                              ? 'shrink-0 tabular-nums text-[var(--color-ink)]'
                              : 'shrink-0 tabular-nums text-[var(--color-positive)]'
                          }
                        >
                          {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="m-0 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
                  Idées en attente
                </h2>
                <a
                  href={`/${locale}/idees`}
                  className="text-sm text-[var(--color-brand-strong)] no-underline"
                >
                  Toutes mes idées
                </a>
              </div>

              {/*
                `min-w-0` sur chaque élément de liste : un enfant de grille refuse par
                défaut de rétrécir sous la taille de son contenu, si bien qu'un titre long
                poussait la ligne hors de la carte au lieu d'être abrégé.
              */}
              {pendingIdeas.length === 0 ? (
                <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
                  Aucune idée en attente. Vous pouvez en chercher de nouvelles à tout moment,
                  adaptées à votre profil.
                </p>
              ) : (
                <ul className="m-0 mt-3 grid list-none gap-3 p-0">
                  {pendingIdeas.map((idea) => (
                    <li key={idea.id} className="min-w-0">
                      <a
                        href={`/${locale}/idees`}
                        className="flex min-w-0 items-baseline gap-3 no-underline"
                      >
                        <span
                          className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                          style={{ background: 'var(--gradient-brand)' }}
                        >
                          {idea.opportunityScore}
                        </span>
                        {/*
                          `flex-1` autant que `min-w-0` : sans lui le bloc se dimensionne
                          sur son texte, déborde du lien, et c'est la carte qui le coupe —
                          net, sans points de suspension.
                        */}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-[var(--color-ink)]">
                            {idea.title}
                          </span>
                          <span className="block truncate text-sm text-[var(--color-ink-soft)]">
                            {idea.valueProposition}
                          </span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        {/* ───────────────────────── Le parcours ──────────────────────────── */}
        <Card>
          <CardBody>
            <h2 className="m-0 mb-5 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
              Votre parcours
            </h2>
            <Stepper steps={overview.journey.steps} currentId={next?.id ?? null} />
          </CardBody>
        </Card>

        {/* ────────────────────── Mes applications ────────────────────────── */}
        {projects.length > 0 ? (
          <section>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <h2 className="m-0 text-lg font-semibold">{t('dashboard.title')}</h2>
              <span className="text-sm text-[var(--color-ink-soft)]">
                {slotsLeft === 0
                  ? `${projects.length} sur ${plan.maxProjects}`
                  : `${projects.length} sur ${plan.maxProjects}, ${slotsLeft} de libre`}
              </span>
              <LinkButton href={`/${locale}/idees`} variant="secondary" className="ml-auto">
                Voir mes idées
              </LinkButton>
              {slotsLeft > 0 ? (
                <LinkButton href={`/${locale}/demarrer`}>Nouveau projet</LinkButton>
              ) : null}
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  locale={locale}
                  statusLabel={t(`status.${project.status}` as MessageKey)}
                  canLaunch={canLaunch}
                  windowDays={stats.windowDays}
                  stats={stats.byProject.get(project.id) ?? null}
                  project={{
                    id: project.id,
                    name: project.name,
                    slug: project.slug,
                    status: project.status,
                    tagline: project.tagline,
                    themeColor: project.themeColor,
                    themeAccent: project.themeAccent,
                    readyScore: project.readyScore,
                    publicUrl:
                      project.status === 'PUBLISHED' ? `${appUrl}/a/${project.slug}` : null,
                  }}
                />
              ))}
              {/*
                Une carte d'invitation plutôt qu'un simple bouton : elle occupe la place
                vide de la grille, et dit pourquoi on recommencerait plutôt que seulement
                comment. Quand l'offre est pleine, elle dit franchement ce qui manque.
              */}
              <NewProjectCard locale={locale} slotsLeft={slotsLeft} planName={plan.name} />
            </div>
          </section>
        ) : null}
      </div>
    </Shell>
  )
}

/**
 * Invitation à démarrer un nouveau projet.
 *
 * Rien n'obligeait à ce qu'un créateur s'arrête à une application, et pourtant l'écran ne
 * lui proposait nulle part d'en commencer une autre. Elle prend la place laissée libre par
 * la grille, en pointillés, pour se distinguer des projets réels sans crier plus fort
 * qu'eux.
 */
function NewProjectCard({
  locale,
  slotsLeft,
  planName,
}: {
  locale: string
  slotsLeft: number
  planName: string
}) {
  if (slotsLeft === 0) {
    return (
      <div className="grid place-items-center rounded-[var(--radius-card)] border border-dashed border-[var(--color-line)] p-6 text-center">
        <div>
          <p className="m-0 text-sm font-medium">Votre offre {planName} est complète</p>
          <p className="m-0 mt-1 text-sm text-[var(--color-ink-soft)]">
            Passez à une offre supérieure pour créer une application de plus.
          </p>
          <LinkButton href={`/${locale}#tarifs`} variant="secondary" className="mt-4">
            Voir les offres
          </LinkButton>
        </div>
      </div>
    )
  }

  return (
    <a
      href={`/${locale}/demarrer`}
      className="grid min-h-44 place-items-center rounded-[var(--radius-card)] border border-dashed border-[var(--color-line)] p-6 text-center no-underline transition-colors hover:border-[var(--color-brand)]"
    >
      <div>
        <span
          aria-hidden="true"
          className="mx-auto grid h-11 w-11 place-items-center rounded-full text-xl font-semibold text-white"
          style={{ background: 'var(--gradient-brand)' }}
        >
          +
        </span>
        <p className="m-0 mt-3 text-base font-semibold text-[var(--color-ink)]">Nouveau projet</p>
        <p className="m-0 mt-1 text-sm text-[var(--color-ink-soft)]">
          Partez d’une idée à trouver, ou de celle que vous avez déjà en tête.
        </p>
      </div>
    </a>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="m-0 text-xs uppercase tracking-wide text-white/50">{label}</p>
      <p className="m-0 mt-1 text-xl font-semibold">{value}</p>
    </div>
  )
}

/**
 * Avancement du parcours.
 *
 * Un anneau plutôt qu'une barre : à cet endroit de la page il tient dans un coin, se lit
 * d'un coup d'œil, et laisse la largeur aux chiffres qui comptent. Le tracé est en SVG,
 * donc net à toutes les tailles et sans image à charger.
 */
function Progress({ value }: { value: number }) {
  const radius = 42
  const circumference = 2 * Math.PI * radius
  return (
    <div className="relative h-28 w-28 shrink-0 justify-self-start sm:justify-self-end">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <defs>
          <linearGradient id="progress-brand" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7b5cff" />
            <stop offset="100%" stopColor="#37c6f0" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="url(#progress-brand)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value / 100)}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="text-2xl font-semibold">{value}</span>
        <span className="sr-only">pour cent du parcours accompli</span>
      </div>
    </div>
  )
}

/**
 * Parcours en étapes.
 *
 * Trois états distincts, et pas seulement fait ou pas fait : l'étape en cours est celle
 * qu'on cherche des yeux en arrivant, elle mérite d'être la plus visible. Les pastilles
 * sont dessinées plutôt qu'écrites en émoji — un émoji ne se colore pas, ne s'aligne pas,
 * et change de dessin d'un appareil à l'autre.
 */
function Stepper({ steps, currentId }: { steps: JourneyStep[]; currentId: string | null }) {
  return (
    <ol className="m-0 grid list-none gap-0 p-0">
      {steps.map((step, index) => {
        const current = step.id === currentId
        const last = index === steps.length - 1
        return (
          <li key={step.id} className="grid grid-cols-[auto_1fr] gap-x-4">
            <div className="grid justify-items-center">
              <span
                aria-hidden="true"
                className={`grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ${
                  step.done
                    ? 'text-white'
                    : current
                      ? 'text-white'
                      : 'border border-[var(--color-line)] text-[var(--color-ink-faint)]'
                }`}
                style={
                  step.done
                    ? { background: 'var(--color-positive)' }
                    : current
                      ? { background: 'var(--gradient-brand)' }
                      : undefined
                }
              >
                {step.done ? '✓' : index + 1}
              </span>
              {last ? null : (
                <span
                  aria-hidden="true"
                  className="my-1 w-px flex-1 self-stretch"
                  style={{
                    minHeight: '1.25rem',
                    background: step.done ? 'var(--color-positive)' : 'var(--color-line)',
                  }}
                />
              )}
            </div>
            <div className={last ? 'pb-0' : 'pb-5'}>
              <p
                className={`m-0 text-sm ${
                  step.done
                    ? 'text-[var(--color-ink)]'
                    : current
                      ? 'font-semibold text-[var(--color-ink)]'
                      : 'text-[var(--color-ink-soft)]'
                }`}
              >
                {step.label}
                {step.skipped === true ? (
                  <span className="ml-2 text-xs text-[var(--color-ink-faint)]">sans objet</span>
                ) : null}
              </p>
              {current ? (
                <p className="m-0 mt-0.5 text-sm text-[var(--color-ink-soft)]">{step.why}</p>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
