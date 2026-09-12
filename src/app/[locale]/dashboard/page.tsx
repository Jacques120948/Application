import { redirect } from 'next/navigation'
import { getTranslator, resolveLocale, type MessageKey } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { getWallet } from '@/server/billing/credits'
import { getEntitlements } from '@/server/billing/entitlements'
import { LAUNCH_KIT_FEATURE } from '@/server/billing/features'
import { listProjects, type ProjectSummary } from '@/server/projects/service'
import { getCreatorOverview } from '@/server/business/overview'
import { OBJECTIVE_DISCLAIMER } from '@/server/business/economics'
import type { JourneyStep } from '@/server/business/journey'
import { Badge, Card, CardBody, LinkButton } from '@/components/ui'
import { Shell } from '@/components/studio/Shell'

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

  const [overview, projects, wallet, entitlements] = await Promise.all([
    getCreatorOverview(user.id, locale),
    listProjects(user.id),
    getWallet(user.id),
    getEntitlements(user.id),
  ])

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
            <div className="mb-4 flex flex-wrap items-center gap-4">
              <h2 className="m-0 text-lg font-semibold">{t('dashboard.title')}</h2>
              <LinkButton href={`/${locale}/idees`} variant="secondary" className="ml-auto">
                Voir mes idées
              </LinkButton>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  locale={locale}
                  statusLabel={t(`status.${project.status}` as MessageKey)}
                  canLaunch={canLaunch}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </Shell>
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

/**
 * Vignette d'une application.
 *
 * Elle porte les couleurs de l'application et son accroche, pas une pastille de couleur
 * unie : c'est ce qui permet de reconnaître son projet sans lire son nom, surtout quand on
 * en a plusieurs.
 */
function ProjectCard({
  project,
  locale,
  statusLabel,
  canLaunch,
}: {
  project: ProjectSummary
  locale: string
  statusLabel: string
  canLaunch: boolean
}) {
  const published = project.status === 'PUBLISHED'
  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <a href={`/${locale}/projets/${project.id}`} className="no-underline">
        <div
          className="relative h-28 overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${project.themeColor} 0%, ${project.themeAccent} 100%)`,
          }}
          aria-hidden="true"
        >
          <div
            className="absolute -right-8 -top-10 h-32 w-32 rounded-full opacity-25 blur-2xl"
            style={{ background: '#ffffff' }}
          />
        </div>
        <CardBody className="grid gap-2">
          <div className="flex items-start gap-3">
            <h3 className="m-0 text-base font-semibold text-[var(--color-ink)]">{project.name}</h3>
            <span className="ml-auto shrink-0">
              <Badge tone={published ? 'positive' : 'neutral'}>{statusLabel}</Badge>
            </span>
          </div>
          {project.tagline === '' ? null : (
            <p className="m-0 line-clamp-2 text-sm text-[var(--color-ink-soft)]">
              {project.tagline}
            </p>
          )}
          <p className="m-0 text-xs text-[var(--color-ink-faint)]">
            {project.readyScore === null
              ? 'Pas encore testée'
              : `Prête à ${project.readyScore} %`}
          </p>
        </CardBody>
      </a>
      {published && canLaunch ? (
        <div className="mt-auto border-t border-[var(--color-line)] px-5 py-3">
          <a
            href={`/${locale}/projets/${project.id}/marketing`}
            className="text-sm font-medium text-[var(--color-brand-strong)] no-underline"
          >
            Préparer son lancement →
          </a>
        </div>
      ) : null}
    </Card>
  )
}
