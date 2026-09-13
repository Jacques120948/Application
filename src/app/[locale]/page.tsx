import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslator, resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { LAUNCH_KIT_FEATURE } from '@/server/billing/features'
import { listPublicPlans } from '@/server/billing/plans'
import { customersNeededFor, formatAmount } from '@/server/business/economics'
import { isEnabled } from '@/server/settings/flags'
import { DEMO_APPS } from '@/server/demos/catalog'
import { Logo } from '@/components/marketing/Logo'
import { BrowserFrame, PhoneFrame } from '@/components/marketing/DeviceFrame'
import { LinkButton } from '@/components/ui'

/**
 * Page publique.
 *
 * Elle montre d'abord, elle explique ensuite. Les captures sont celles des applications de
 * démonstration réellement publiées par le moteur (voir server/demos/catalog.ts) : aucune
 * maquette inventée, aucun faux témoignage, aucun faux client. La grille tarifaire est lue
 * en base, et les nombres de clients sont calculés par server/business/economics.ts.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const t = getTranslator(resolveLocale((await params).locale))
  return { title: t('landing.metaTitle'), description: t('landing.metaDescription') }
}

/**
 * Espace d'images d'une offre, en toutes lettres.
 *
 * Arrondi volontairement : « 250 Mo » se retient, « 250.0 Mo » fait comptable et n'apprend
 * rien de plus à qui compare deux offres.
 */
function storageLabel(bytes: number): string {
  const megabytes = Math.round(bytes / (1024 * 1024))
  return megabytes >= 1024 ? `${Math.round(megabytes / 1024)} Go` : `${megabytes} Mo`
}

/** Objectif de référence des exemples chiffrés : mille euros de chiffre d'affaires mensuel. */
const REFERENCE_GOAL_CENTS = 100_000

function Check({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className ?? 'mt-0.5 h-4 w-4 shrink-0'} aria-hidden="true">
      <path
        d="M4 10.5l4 4 8-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Section({
  id,
  title,
  body,
  tone = 'canvas',
  children,
}: {
  id?: string
  title: string
  body?: string
  tone?: 'canvas' | 'surface'
  children: React.ReactNode
}) {
  const shell =
    tone === 'surface'
      ? 'border-y border-[var(--color-line)] bg-[var(--color-surface)]'
      : 'bg-[var(--color-canvas)]'
  return (
    <section id={id} className={`scroll-mt-20 ${shell}`}>
      <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:py-24">
        <h2 className="max-w-3xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h2>
        {body !== undefined ? (
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[var(--color-ink-soft)]">
            {body}
          </p>
        ) : null}
        <div className="mt-12">{children}</div>
      </div>
    </section>
  )
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user !== null) redirect(`/${locale}/dashboard`)

  const t = getTranslator(locale)
  const [plans, socialOpen] = await Promise.all([
    listPublicPlans(),
    // La page d'accueil ne décrit pas un produit imaginé mais celui de cette installation.
    // Tant que l'envoi vers Postelya est fermé, elle annonce que rien n'est publié ; le jour
    // où il s'ouvre, elle le dit, sans qu'une ligne soit à réécrire.
    isEnabled('socialPublishing'),
  ])

  // Deux entrées distinctes : l'une conduit au parcours guidé, l'autre à la description
  // directe. Le bouton d'en-tête, lui, laisse choisir une fois le compte créé.
  const signUp = `/${locale}/inscription`
  const findIdea = `/${locale}/inscription?suite=objectif`
  const haveIdea = `/${locale}/inscription?suite=idee`

  const steps = [
    { title: t('landing.step1Title'), body: t('landing.step1Body') },
    { title: t('landing.step2Title'), body: t('landing.step2Body') },
    { title: t('landing.step3Title'), body: t('landing.step3Body') },
    { title: t('landing.step4Title'), body: t('landing.step4Body') },
    { title: t('landing.step5Title'), body: t('landing.step5Body') },
    { title: t('landing.step6Title'), body: t('landing.step6Body') },
    { title: t('landing.step7Title'), body: t('landing.step7Body') },
  ]

  const promises = [
    { title: t('landing.honest1Title'), body: t('landing.honest1Body') },
    { title: t('landing.honest2Title'), body: t('landing.honest2Body') },
    { title: t('landing.honest3Title'), body: t('landing.honest3Body') },
  ]

  const faq = [
    { q: t('landing.faq1Q'), a: t('landing.faq1A') },
    { q: t('landing.faq2Q'), a: t('landing.faq2A') },
    { q: t('landing.faq3Q'), a: t('landing.faq3A') },
    { q: t('landing.faq4Q'), a: t('landing.faq4A') },
    { q: t('landing.faq5Q'), a: t('landing.faq5A') },
    { q: t('landing.faq6Q'), a: t('landing.faq6A') },
  ]

  // Les nombres de clients ne sont pas écrits à la main : ils sortent du même calcul que
  // celui du parcours, à partir du prix affiché.
  const projects = [
    { name: t('landing.project1Name'), priceCents: 1900, difficulty: t('landing.difficultyEasy') },
    { name: t('landing.project2Name'), priceCents: 990, difficulty: t('landing.difficultyEasy') },
    { name: t('landing.project3Name'), priceCents: 1490, difficulty: t('landing.difficultyMedium') },
    { name: t('landing.project4Name'), priceCents: 1200, difficulty: t('landing.difficultyEasy') },
  ].map((project) => ({
    ...project,
    customers: customersNeededFor(REFERENCE_GOAL_CENTS, project.priceCents, 'month') ?? 0,
  }))

  const heroShots = DEMO_APPS.filter((demo) =>
    ['devisflow', 'fitpilot', 'bookizy'].includes(demo.slug),
  )
  const showcase = DEMO_APPS.filter((demo) => ['immotrack', 'studyflow'].includes(demo.slug))
  const cooksy = DEMO_APPS.find((demo) => demo.slug === 'cooksy')

  return (
    <div className="min-h-screen">
      {/* ─────────────────────────── En-tête ─────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[color-mix(in_srgb,var(--color-surface)_88%,transparent)] backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-5 py-3">
          <a href={`/${locale}`} className="text-[var(--color-ink)] no-underline">
            <Logo
              id="mark-header"
              wordmark={t('common.appName')}
              wordmarkClassName="hidden sm:inline"
            />
          </a>
          <nav className="ml-6 hidden items-center gap-6 text-sm lg:flex">
            <a href="#creer" className="text-[var(--color-ink-soft)] no-underline">
              {t('landing.navCreate')}
            </a>
            <a href="#fonctionnement" className="text-[var(--color-ink-soft)] no-underline">
              {t('landing.navHow')}
            </a>
            <a href="#tarifs" className="text-[var(--color-ink-soft)] no-underline">
              {t('landing.navPricing')}
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <LinkButton href={`/${locale}/connexion`} variant="ghost">
              {t('nav.login')}
            </LinkButton>
            <LinkButton href={signUp}>{t('nav.register')}</LinkButton>
          </div>
        </div>
      </header>

      {/* ──────────────────────────── 1. Hero ─────────────────────────── */}
      <section
        className="on-night relative overflow-hidden text-white"
        style={{ background: 'var(--gradient-night)' }}
      >
        {/*
          Deux halos colorés plutôt qu'un. Un seul laissait la moitié gauche du héros éteinte,
          et c'est justement là que se trouve le titre : la lueur chaude le porte.
        */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-56 right-[-15%] h-[640px] w-[640px] rounded-full opacity-45 blur-3xl"
          style={{ background: 'var(--gradient-brand)' }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[-30%] left-[-20%] h-[560px] w-[560px] rounded-full opacity-30 blur-3xl"
          style={{ background: 'radial-gradient(circle, #f81878 0%, #fc7a3b 45%, transparent 72%)' }}
        />
        <div className="relative mx-auto grid w-full max-w-6xl gap-14 px-5 py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center lg:py-28">
          <div>
            <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white/90">
              {t('landing.eyebrow')}
            </span>
            <h1 className="mt-5 text-balance text-[2.1rem] font-semibold leading-[1.1] tracking-tight sm:text-[2.6rem] xl:text-[3rem]">
              {t('landing.heroTitle')}
              <br />
              <span className="text-gradient-brand">{t('landing.heroTitleAccent')}</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/75">
              {t('landing.heroBody')}
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <LinkButton href={findIdea} size="large">
                {t('landing.ctaFindIdea')}
              </LinkButton>
              <a
                href={haveIdea}
                className="inline-flex items-center justify-center rounded-[var(--radius-control)] border border-white/25 px-6 py-3 text-base font-medium text-white no-underline transition-colors hover:bg-white/10"
              >
                {t('landing.ctaHaveIdea')}
              </a>
            </div>
            <p className="mt-6 text-sm text-white/55">{t('landing.heroNote')}</p>
          </div>

          {/* Montage : trois applications de démonstration, réellement en ligne. */}
          <div className="relative">
            <div className="grid gap-4 sm:grid-cols-[1.35fr_1fr] sm:items-start">
              {heroShots[0] !== undefined ? (
                <BrowserFrame
                  src={`/demos/${heroShots[0].slug}-desktop.webp`}
                  alt={heroShots[0].shotAlt}
                  caption={`evoliia.com/a/${heroShots[0].slug}`}
                  priority
                  className="sm:col-span-2"
                />
              ) : null}
              {heroShots[1] !== undefined ? (
                <BrowserFrame
                  src={`/demos/${heroShots[1].slug}-desktop.webp`}
                  alt={heroShots[1].shotAlt}
                  caption={`evoliia.com/a/${heroShots[1].slug}`}
                />
              ) : null}
              {heroShots[2] !== undefined ? (
                <PhoneFrame
                  src={`/demos/${heroShots[2].slug}-mobile.webp`}
                  alt={heroShots[2].shotAlt}
                  cropHeight={300}
                  className="mx-auto w-36 sm:w-full sm:max-w-[190px]"
                />
              ) : null}
            </div>
            <p className="mt-5 text-center text-xs text-white/50">
              {t('landing.heroShotsCaption')}
            </p>
          </div>
        </div>
      </section>

      {/* ───────────────────── 2. Que pouvez-vous créer ? ──────────────── */}
      <Section id="creer" title={t('landing.buildTitle')} body={t('landing.buildBody')}>
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {DEMO_APPS.map((demo, index) => (
            <article
              key={demo.slug}
              className="reveal flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)]"
            >
              <img
                src={`/demos/${demo.slug}-desktop.webp`}
                alt={demo.shotAlt}
                width={1280}
                height={860}
                loading={index < 2 ? 'eager' : 'lazy'}
                decoding="async"
                className="block aspect-[1280/860] w-full border-b border-[var(--color-line)] object-cover object-top"
              />
              <div className="flex flex-1 flex-col p-5">
                <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
                  {demo.category}
                </span>
                <h3 className="mt-2 text-lg font-semibold">{demo.spec.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                  {demo.summary}
                </p>
                <p className="mt-3 text-sm font-medium text-[var(--color-brand-strong)]">
                  {demo.priceLabel}
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-3 pt-1">
                  <a
                    href={`/a/${demo.slug}`}
                    className="text-sm font-medium text-[var(--color-brand)]"
                  >
                    {t('landing.buildOpen')} →
                  </a>
                  <a
                    href={findIdea}
                    className="text-sm text-[var(--color-ink-soft)] no-underline hover:text-[var(--color-ink)]"
                  >
                    {t('landing.buildSimilar')}
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
        <p className="mt-8 max-w-3xl text-sm leading-relaxed text-[var(--color-ink-faint)]">
          {t('landing.buildNote')}
        </p>
      </Section>

      {/* ──────────────── 3. Une phrase → une vraie application ─────────── */}
      <Section
        title={t('landing.oneLineTitle')}
        body={t('landing.oneLineBody')}
        tone="surface"
      >
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start">
          <div className="reveal">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
              {t('landing.oneLinePromptLabel')}
            </span>
            <blockquote className="mt-3 rounded-[var(--radius-card)] border border-[var(--color-brand)] bg-[var(--color-brand-soft)] p-5 text-lg leading-relaxed">
              « {t('landing.oneLinePrompt')} »
            </blockquote>

            <ul className="mt-6 grid gap-2 text-sm text-[var(--color-ink-soft)]">
              {[
                t('landing.oneLineFeature1'),
                t('landing.oneLineFeature2'),
                t('landing.oneLineFeature3'),
                t('landing.oneLineFeature4'),
                t('landing.oneLineFeature5'),
                t('landing.oneLineFeature6'),
              ].map((feature) => (
                <li key={feature} className="flex gap-2">
                  <span className="text-[var(--color-brand)]">
                    <Check />
                  </span>
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

          </div>

          <div className="reveal">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
              {t('landing.oneLineResultLabel')}
            </span>
            {cooksy !== undefined ? (
              <>
                <div className="mt-3 grid gap-4 sm:grid-cols-[1.5fr_0.5fr] sm:items-end">
                  <BrowserFrame
                    src="/demos/cooksy-recettes-desktop.webp"
                    alt={cooksy.shotAlt}
                    caption={`evoliia.com/a/${cooksy.slug}`}
                  />
                  <PhoneFrame
                    src="/demos/cooksy-recettes-mobile.webp"
                    alt={cooksy.shotAlt}
                    className="mx-auto w-32 sm:w-full"
                  />
                </div>
                <a
                  href={`/a/${cooksy.slug}`}
                  className="mt-5 inline-block text-sm font-medium text-[var(--color-brand)]"
                >
                  {t('landing.oneLineOpen')} →
                </a>
              </>
            ) : null}
          </div>
        </div>

        <div className="reveal mt-10 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-canvas)] p-6">
          <h3 className="m-0 text-base font-semibold">{t('landing.oneLineEditTitle')}</h3>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-soft)]">
            {t('landing.oneLineEditBody')}
          </p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              t('landing.oneLineEdit1'),
              t('landing.oneLineEdit2'),
              t('landing.oneLineEdit3'),
            ].map((edit) => (
              <li
                key={edit}
                className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-sm"
              >
                « {edit} »
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* ─────────────── 4. Vous n'avez pas encore d'idée ─────────────── */}
      <Section title={t('landing.noIdeaTitle')} body={t('landing.noIdeaBody')}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-stretch">
          <div className="reveal rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
              {t('landing.profileLabel')}
            </span>
            <dl className="mt-4 grid gap-3 text-sm">
              {[
                { label: t('landing.profileJob'), value: t('landing.profileJobValue') },
                {
                  label: t('landing.profileExperience'),
                  value: t('landing.profileExperienceValue'),
                },
                { label: t('landing.profileTime'), value: t('landing.profileTimeValue') },
                { label: t('landing.profileBudget'), value: t('landing.profileBudgetValue') },
                { label: t('landing.profileGoal'), value: t('landing.profileGoalValue') },
              ].map((row) => (
                <div
                  key={row.label}
                  className="flex items-baseline justify-between gap-4 border-b border-[var(--color-line)] pb-2 last:border-0"
                >
                  <dt className="text-[var(--color-ink-soft)]">{row.label}</dt>
                  <dd className="font-medium">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div
            className="reveal rounded-[var(--radius-card)] p-6 text-white"
            style={{ background: 'var(--gradient-night)' }}
          >
            <span className="text-xs font-medium uppercase tracking-wide text-white/60">
              {t('landing.suggestionLabel')}
            </span>
            <h3 className="mt-3 text-xl font-semibold">{t('landing.suggestionName')}</h3>
            <dl className="mt-6 grid gap-5 sm:grid-cols-2">
              {[
                { label: t('landing.suggestionScore'), value: t('landing.suggestionScoreValue') },
                {
                  label: t('landing.suggestionDifficulty'),
                  value: t('landing.suggestionDifficultyValue'),
                },
                { label: t('landing.suggestionPrice'), value: t('landing.suggestionPriceValue') },
                { label: t('landing.suggestionTarget'), value: t('landing.suggestionTargetValue') },
              ].map((row) => (
                <div key={row.label}>
                  <dt className="text-xs text-white/55">{row.label}</dt>
                  <dd className="mt-1 text-base font-semibold">{row.value}</dd>
                </div>
              ))}
            </dl>
            <LinkButton href={findIdea} className="mt-7">
              {t('landing.suggestionCta')}
            </LinkButton>
            <p className="mt-5 border-t border-white/15 pt-4 text-xs leading-relaxed text-white/50">
              {t('landing.suggestionDisclaimer')}
            </p>
          </div>
        </div>
      </Section>

      {/* ────────────── 5. Quel projet pourriez-vous lancer ? ───────────── */}
      <Section
        title={t('landing.projectsTitle')}
        body={t('landing.projectsBody')}
        tone="surface"
      >
        <p className="-mt-6 mb-6 text-sm font-medium text-[var(--color-brand-strong)]">
          {t('landing.projectsGoal')}
        </p>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {projects.map((project) => (
            <div
              key={project.name}
              className="reveal rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-canvas)] p-5"
            >
              <h3 className="m-0 text-base font-semibold">{project.name}</h3>
              <p className="mt-3 text-2xl font-semibold tracking-tight">
                {formatAmount(project.priceCents)}
                <span className="ml-1 text-sm font-normal text-[var(--color-ink-faint)]">
                  {t('landing.pricingPerMonth')}
                </span>
              </p>
              <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
                {t('landing.projectsCustomers', { count: project.customers })}
              </p>
              <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
                {t('landing.projectsDifficulty')} : {project.difficulty}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-5">
          <LinkButton href={findIdea} size="large">
            {t('landing.projectsCta')}
          </LinkButton>
        </div>
        <p className="mt-6 max-w-3xl text-sm leading-relaxed text-[var(--color-ink-faint)]">
          {t('landing.projectsNote')}
        </p>
      </Section>

      {/* ──────────────── 6. Comment fonctionne Evoliia ─────────────────── */}
      <Section id="fonctionnement" title={t('landing.howTitle')} body={t('landing.howBody')}>
        <ol className="grid list-none gap-5 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((step, index) => (
            <li
              key={step.title}
              className="reveal rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5"
            >
              <span
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold text-white"
                style={{ background: 'var(--gradient-brand)' }}
              >
                {index + 1}
              </span>
              <h3 className="mt-4 text-base font-semibold">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </Section>

      {/* ───────────────────── 7. Créé avec Evoliia ─────────────────────── */}
      <section className="on-night text-white" style={{ background: 'var(--gradient-night)' }}>
        <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:py-24">
          <h2 className="max-w-3xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            {t('landing.showcaseTitle')}
          </h2>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-white/70">
            {t('landing.showcaseBody')}
          </p>

          <div className="mt-12 grid gap-12">
            {showcase.map((demo) => (
              <div
                key={demo.slug}
                className="reveal grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_220px]"
              >
                <BrowserFrame
                  src={`/demos/${demo.slug}-desktop.webp`}
                  alt={demo.shotAlt}
                  caption={`evoliia.com/a/${demo.slug}`}
                  className="w-full"
                />
                <div>
                  <PhoneFrame
                    src={`/demos/${demo.slug}-mobile.webp`}
                    alt={demo.shotAlt}
                    cropHeight={360}
                    className="mx-auto w-40 lg:w-full"
                  />
                  <p className="mt-3 text-center text-xs text-white/50">
                    {t('landing.showcaseMobileLabel')}
                  </p>
                  <p className="mt-4 text-center text-sm font-semibold lg:text-left">
                    {demo.spec.name}
                  </p>
                  <p className="mt-1 text-center text-xs text-white/60 lg:text-left">
                    {demo.category}
                  </p>
                  <a
                    href={`/a/${demo.slug}`}
                    className="mt-3 block text-center text-sm font-medium text-white lg:text-left"
                  >
                    {t('landing.buildOpen')} →
                  </a>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-12 max-w-3xl text-sm leading-relaxed text-white/50">
            {t('landing.showcaseNote')}
          </p>
        </div>
      </section>

      {/* ───────────────── 8. Préparer son lancement ────────────────────── */}
      <Section
        id="lancement"
        title={t('landing.launchTitle')}
        body={t('landing.launchBody')}
        tone="surface"
      >
        <div className="grid gap-5 md:grid-cols-3">
          {[
            { title: t('landing.launchAnglesTitle'), body: t('landing.launchAnglesBody') },
            { title: t('landing.launchIdeasTitle'), body: t('landing.launchIdeasBody') },
            { title: t('landing.launchWeekTitle'), body: t('landing.launchWeekBody') },
          ].map((card) => (
            <div
              key={card.title}
              className="edge-brand reveal rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 pt-7"
            >
              <h3 className="m-0 text-base font-semibold">{card.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                {card.body}
              </p>
            </div>
          ))}
        </div>

        {/*
          Ce qui vient du parcours, et ce qu'il advient du kit : les deux côte à côte.
          La seconde carte dit la vérité de cette installation, et non une intention. Tant
          que l'envoi est fermé, elle annonce qu'aucune publication n'a lieu, ce qui évite
          la déception de celui qui croirait acheter une publication automatique.
        */}
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div className="rounded-[var(--radius-card)] border-2 border-[var(--color-brand)] bg-[var(--color-brand-soft)] p-6">
            <h3 className="m-0 text-base font-semibold text-[var(--color-brand-strong)]">
              {t('landing.launchSourceTitle')}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              {t('landing.launchSourceBody')}
            </p>
          </div>
          <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
            <h3 className="m-0 text-base font-semibold text-[var(--color-ink-soft)]">
              {socialOpen ? t('landing.launchSendTitle') : t('landing.launchLimitTitle')}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              {socialOpen ? t('landing.launchSendBody') : t('landing.launchLimitBody')}
            </p>
          </div>
        </div>

        <p className="mt-6 text-sm text-[var(--color-ink-soft)]">
          {t('landing.launchIncluded')}
        </p>
      </Section>

      {/* ─────────── 9. Plus qu'un générateur d'applications ───────────── */}
      <Section title={t('landing.compareTitle')} body={t('landing.compareBody')}>
        <div className="grid gap-5 md:grid-cols-2">
          <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
            <h3 className="m-0 text-base font-semibold text-[var(--color-ink-soft)]">
              {t('landing.compareLeftTitle')}
            </h3>
            <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
              {t('landing.compareLeftIntro')}
            </p>
            <ul className="mt-4 grid gap-2 text-sm text-[var(--color-ink-soft)]">
              {[
                t('landing.compareLeft1'),
                t('landing.compareLeft2'),
                t('landing.compareLeft3'),
                t('landing.compareLeft4'),
              ].map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden="true" className="text-[var(--color-ink-faint)]">
                    —
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-[var(--radius-card)] border-2 border-[var(--color-brand)] bg-[var(--color-brand-soft)] p-6">
            <h3 className="m-0 text-base font-semibold text-[var(--color-brand-strong)]">
              {t('landing.compareRightTitle')}
            </h3>
            <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
              {t('landing.compareRightIntro')}
            </p>
            <ul className="mt-4 grid gap-2 text-sm">
              {[
                t('landing.compareRight1'),
                t('landing.compareRight2'),
                t('landing.compareRight3'),
                t('landing.compareRight4'),
                t('landing.compareRight5'),
                t('landing.compareRight6'),
              ].map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="text-[var(--color-brand)]">
                    <Check />
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* ─────────────────────────── 9. Tarifs ──────────────────────────── */}
      <Section
        id="tarifs"
        title={t('landing.pricingTitle')}
        body={t('landing.pricingBody')}
        tone="surface"
      >
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => {
            const features = [
              t('landing.pricingCredits', { count: plan.monthlyCredits }),
              plan.allowBuild
                ? plan.maxProjects === 1
                  ? t('landing.pricingProjectsOne')
                  : t('landing.pricingProjects', { count: plan.maxProjects })
                : t('landing.pricingNoBuild'),
              ...(plan.allowBuild
                ? [t('landing.pricingBuild'), t('landing.pricingInstall')]
                : []),
              ...(plan.storageBytes > 0
                ? [t('landing.pricingImages', { size: storageLabel(plan.storageBytes) })]
                : []),
              ...(plan.features.includes(LAUNCH_KIT_FEATURE)
                ? [t('landing.pricingLaunchKit')]
                : []),
              ...(plan.allowCustomDomain ? [t('landing.pricingDomain')] : []),
              ...(plan.allowMobilePrep ? [t('landing.pricingMobile')] : []),
              ...(plan.allowExport ? [t('landing.pricingExport')] : []),
            ]
            return (
              <div
                key={plan.id}
                className={
                  plan.isRecommended
                    ? 'ring-brand [--ring-fill:var(--color-canvas)] relative flex flex-col rounded-[var(--radius-card)] p-6 shadow-[0_22px_48px_-26px_rgba(151,5,244,0.6)]'
                    : 'relative flex flex-col rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-canvas)] p-6'
                }
              >
                {plan.isRecommended ? (
                  <span
                    className="absolute -top-3 left-6 rounded-full px-2.5 py-1 text-xs font-semibold text-white"
                    style={{ background: 'var(--gradient-brand)' }}
                  >
                    {t('landing.pricingRecommended')}
                  </span>
                ) : null}
                <h3 className="text-base font-semibold">{plan.name}</h3>
                <p className="mt-3 text-3xl font-semibold tracking-tight">
                  {plan.priceCents === 0
                    ? t('landing.pricingFree')
                    : formatAmount(plan.priceCents, plan.currency)}
                </p>
                {plan.priceCents > 0 ? (
                  <p className="text-xs text-[var(--color-ink-faint)]">
                    {t('landing.pricingPerMonth')}
                  </p>
                ) : null}
                <p className="mt-4 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                  {plan.description}
                </p>
                <ul className="mt-5 mb-6 grid gap-2 text-sm text-[var(--color-ink-soft)]">
                  {features.map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <span className="text-[var(--color-brand)]">
                        <Check />
                      </span>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <LinkButton
                  href={findIdea}
                  variant={plan.isRecommended ? 'primary' : 'secondary'}
                  className="mt-auto w-full"
                >
                  {plan.priceCents === 0
                    ? t('landing.pricingCtaFree')
                    : t('landing.pricingCtaPaid')}
                </LinkButton>
              </div>
            )
          })}
        </div>
        <p className="mt-8 max-w-3xl text-sm leading-relaxed text-[var(--color-ink-soft)]">
          {t('landing.pricingNote')}
        </p>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[var(--color-ink-faint)]">
          {t('landing.pricingPaymentNote')}
        </p>
      </Section>

      {/* ────────────────────── 10. Transparence ────────────────────────── */}
      <Section title={t('landing.honestTitle')} body={t('landing.honestBody')}>
        <div className="grid gap-5 md:grid-cols-3">
          {promises.map((item) => (
            <div
              key={item.title}
              className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6"
            >
              <h3 className="m-0 text-base font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* ──────────────────────────── 11. FAQ ───────────────────────────── */}
      <Section title={t('landing.faqTitle')} tone="surface">
        <div className="grid max-w-3xl gap-3">
          {faq.map((item) => (
            <details
              key={item.q}
              className="group rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-5 py-4"
            >
              <summary className="cursor-pointer list-none text-base font-medium marker:hidden">
                {item.q}
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-soft)]">{item.a}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* ─────────────────────── 12. Appel final ────────────────────────── */}
      <section
        className="on-night relative overflow-hidden text-white"
        style={{ background: 'var(--gradient-night)' }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full opacity-35 blur-3xl"
          style={{ background: 'var(--gradient-brand)' }}
        />
        <div className="relative mx-auto w-full max-w-3xl px-5 py-20 text-center sm:py-24">
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            {t('landing.finalTitle')}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-white/70">{t('landing.finalBody')}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <LinkButton href={findIdea} size="large">
              {t('landing.finalCta')}
            </LinkButton>
            <a
              href={haveIdea}
              className="inline-flex items-center justify-center rounded-[var(--radius-control)] border border-white/25 px-6 py-3 text-base font-medium text-white no-underline transition-colors hover:bg-white/10"
            >
              {t('landing.ctaHaveIdea')}
            </a>
          </div>
          <p className="mt-6 text-sm text-white/55">{t('landing.heroNote')}</p>
        </div>
      </section>

      {/* ─────────────────────────── Pied ──────────────────────────────── */}
      <footer className="mx-auto w-full max-w-6xl px-5 py-12">
        <div className="flex flex-wrap items-center gap-6">
          <Logo id="mark-footer" wordmark={t('common.appName')} />
          <p className="max-w-md text-sm text-[var(--color-ink-soft)]">
            {t('landing.footerTagline')}
          </p>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-5 border-t border-[var(--color-line)] pt-6 text-sm text-[var(--color-ink-soft)]">
          <a href={`/${locale}/mentions-legales`} className="no-underline">
            {t('landing.footerLegal')}
          </a>
          <a href={`/${locale}/conditions`} className="no-underline">
            {t('landing.footerTerms')}
          </a>
          <a href={`/${locale}/confidentialite`} className="no-underline">
            {t('landing.footerPrivacy')}
          </a>
          <p className="m-0 ml-auto text-xs text-[var(--color-ink-faint)]">
            © {new Date().getFullYear()} Evoliia. {t('landing.footerRights')}
          </p>
        </div>
      </footer>
    </div>
  )
}
