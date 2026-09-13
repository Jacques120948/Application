import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslator, resolveLocale } from '@/i18n'
import { env } from '@/lib/env'
import { getCurrentUser } from '@/server/auth/session'
import { LAUNCH_KIT_FEATURE } from '@/server/billing/features'
import { listPublicPlans } from '@/server/billing/plans'
import { customersNeededFor, formatAmount } from '@/server/business/economics'
import { DEMO_APPS } from '@/server/demos/catalog'
import { isEnabled } from '@/server/settings/flags'
import { Logo } from '@/components/marketing/Logo'
import { BrowserFrame, PhoneFrame } from '@/components/marketing/DeviceFrame'
import { ModuleGrid, ModuleShowcase, type Showcase, type Tile } from '@/components/marketing/modules'
import {
  Check,
  CheckList,
  DemoGallery,
  DoorCards,
  Eyebrow,
  FlowRail,
  NumberedSteps,
  Panel,
  Section,
  Timeline,
} from '@/components/marketing/landing'
import { LandingHeader } from '@/components/marketing/LandingHeader'
import { LinkButton } from '@/components/ui'

/**
 * Page publique.
 *
 * Elle raconte une chose et une seule : on peut arriver ici sans idée. C'est la différence
 * d'Evoliia avec un générateur d'applications, et tout l'ordre des sections en découle —
 * l'envie, puis le profil, puis les trois portes d'entrée, et seulement ensuite ce que la
 * plateforme sait construire.
 *
 * Rien n'y est inventé. Les captures sont celles des démonstrations réellement publiées par
 * le moteur (voir server/demos/catalog.ts), la grille tarifaire est lue en base, les nombres
 * de clients sont calculés par server/business/economics.ts, et il n'y a ni témoignage, ni
 * logo client, ni compteur d'utilisateurs : nous n'en avons pas.
 *
 * La mise en forme est déléguée à components/marketing/landing.tsx. Ici ne restent que le
 * contenu et son ordre.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const locale = resolveLocale((await params).locale)
  const t = getTranslator(locale)
  const title = t('landing.metaTitle')
  const description = t('landing.metaDescription')
  return {
    title,
    description,
    alternates: { canonical: `/${locale}`, languages: { fr: '/fr', en: '/en' } },
    openGraph: {
      title,
      description,
      type: 'website',
      locale: locale === 'fr' ? 'fr_FR' : 'en_US',
      siteName: t('common.appName'),
      // Capture d'une démonstration réelle, recadrée au format attendu par les réseaux.
      // Aucune maquette inventée, là non plus.
      images: [{ url: '/partage.jpg', width: 1200, height: 630, alt: title }],
    },
    twitter: { card: 'summary_large_image', title, description, images: ['/partage.jpg'] },
  }
}

/** Objectif de référence des exemples chiffrés : mille euros de chiffre d'affaires mensuel. */
const REFERENCE_GOAL_CENTS = 100_000

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

  /*
   * Bêta privée. L'installation exige un code d'accès quand SIGNUP_CODE est définie ; la
   * page le dit avant le clic, plutôt que de laisser la personne le découvrir devant le
   * formulaire. Le jour du lancement public, retirer la variable suffit : ce paragraphe
   * disparaît de lui-même.
   */
  const privateBeta = env.signupCode !== undefined

  // Deux entrées distinctes : l'une conduit au parcours guidé, l'autre à la description
  // directe. Le bouton d'en-tête, lui, laisse choisir une fois le compte créé.
  const signUp = `/${locale}/inscription`
  const findIdea = `/${locale}/inscription?suite=objectif`
  const haveIdea = `/${locale}/inscription?suite=idee`

  const navLinks = [
    { label: t('landing.navHow'), href: '#fonctionnement' },
    { label: t('landing.navExamples'), href: '#exemples' },
    { label: t('landing.navFeatures'), href: '#fonctionnalites' },
    { label: t('landing.navModules'), href: '#modules' },
    { label: t('landing.navPricing'), href: '#tarifs' },
  ]

  /*
   * « Compris dans… » : lu dans les offres réelles, jamais écrit en dur. La première offre
   * (par ordre d'affichage) qui ouvre un module donne son nom ; si c'est l'offre gratuite,
   * on dit « toutes les offres ». Un module qu'aucune offre n'ouvre ne porte pas de badge.
   */
  const includedIn = (test: (plan: (typeof plans)[number]) => boolean): string | null => {
    const first = plans.find(test)
    if (first === undefined) return null
    return first.priceCents === 0 ? t('landing.modulesAllPlans') : t('landing.modulesFrom', { plan: first.name })
  }
  const everywhere = plans.length > 0 ? t('landing.modulesAllPlans') : null
  const showcase: Showcase[] = [
    {
      icon: 'radar',
      eyebrow: t('landing.modRadarEyebrow'),
      title: t('landing.modRadarTitle'),
      body: t('landing.modRadarBody'),
      bullets: [t('landing.modRadar1'), t('landing.modRadar2'), t('landing.modRadar3'), t('landing.modRadar4')],
      included: includedIn((plan) => plan.features.includes('radar') && plan.radarRunsPerMonth > 0),
      desktop: { src: '/modules/radar.webp', alt: t('landing.modRadarEyebrow'), caption: 'evoliia.com/radar' },
    },
    {
      icon: 'wand',
      eyebrow: t('landing.modBuildEyebrow'),
      title: t('landing.modBuildTitle'),
      body: t('landing.modBuildBody'),
      bullets: [t('landing.modBuild1'), t('landing.modBuild2'), t('landing.modBuild3'), t('landing.modBuild4')],
      included: includedIn((plan) => plan.allowBuild),
      desktop: { src: '/modules/atelier.webp', alt: t('landing.modBuildEyebrow') },
    },
    {
      icon: 'chat',
      eyebrow: t('landing.modLiaEyebrow'),
      title: t('landing.modLiaTitle'),
      body: t('landing.modLiaBody'),
      bullets: [t('landing.modLia1'), t('landing.modLia2'), t('landing.modLia3'), t('landing.modLia4')],
      included: includedIn((plan) => plan.features.includes('lia_support') && plan.liaAnswersPerMonth > 0),
      desktop: { src: '/modules/support.webp', alt: t('landing.modLiaEyebrow') },
      phone: { src: '/modules/lia-mobile.webp', alt: t('landing.modLiaEyebrow') },
    },
    {
      icon: 'megaphone',
      eyebrow: t('landing.modLaunchEyebrow'),
      title: t('landing.modLaunchTitle'),
      body: t('landing.modLaunchBody'),
      bullets: [t('landing.modLaunch1'), t('landing.modLaunch2'), t('landing.modLaunch3'), t('landing.modLaunch4')],
      included: includedIn((plan) => plan.features.includes(LAUNCH_KIT_FEATURE)),
      desktop: { src: '/modules/equipe.webp', alt: t('landing.modLaunchEyebrow') },
    },
  ]
  const tiles: Tile[] = [
    { icon: 'target', title: t('landing.tileGoalTitle'), body: t('landing.tileGoalBody'), included: everywhere },
    { icon: 'bulb', title: t('landing.tileIdeasTitle'), body: t('landing.tileIdeasBody'), included: everywhere },
    { icon: 'search', title: t('landing.tileAnalysisTitle'), body: t('landing.tileAnalysisBody'), included: everywhere },
    { icon: 'radar', title: t('landing.tileRadarTitle'), body: t('landing.tileRadarBody'), included: includedIn((plan) => plan.features.includes('radar') && plan.radarRunsPerMonth > 0) },
    { icon: 'document', title: t('landing.tileSpecTitle'), body: t('landing.tileSpecBody'), included: everywhere },
    { icon: 'wand', title: t('landing.tileBuildTitle'), body: t('landing.tileBuildBody'), included: includedIn((plan) => plan.allowBuild) },
    { icon: 'blocks', title: t('landing.tileBlocksTitle'), body: t('landing.tileBlocksBody'), included: includedIn((plan) => plan.allowBuild) },
    { icon: 'palette', title: t('landing.tileDesignTitle'), body: t('landing.tileDesignBody'), included: includedIn((plan) => plan.allowBuild) },
    { icon: 'users', title: t('landing.tileUsersTitle'), body: t('landing.tileUsersBody'), included: includedIn((plan) => plan.allowBuild) },
    { icon: 'coins', title: t('landing.tileMoneyTitle'), body: t('landing.tileMoneyBody'), included: includedIn((plan) => plan.allowBuild) },
    { icon: 'shield', title: t('landing.tileTestsTitle'), body: t('landing.tileTestsBody'), included: includedIn((plan) => plan.allowBuild) },
    { icon: 'rocket', title: t('landing.tilePublishTitle'), body: t('landing.tilePublishBody'), included: includedIn((plan) => plan.allowBuild) },
    { icon: 'download', title: t('landing.tileExportTitle'), body: t('landing.tileExportBody'), included: includedIn((plan) => plan.allowExport || plan.allowMobilePrep) },
    { icon: 'plug', title: t('landing.tileConnectTitle'), body: t('landing.tileConnectBody'), included: includedIn((plan) => plan.maxConnections > 0) },
    { icon: 'lifebuoy', title: t('landing.tileCoachTitle'), body: t('landing.tileCoachBody'), included: everywhere },
    { icon: 'chart', title: t('landing.tileDashboardTitle'), body: t('landing.tileDashboardBody'), included: everywhere },
    { icon: 'megaphone', title: t('landing.tileKitTitle'), body: t('landing.tileKitBody'), included: includedIn((plan) => plan.features.includes(LAUNCH_KIT_FEATURE)) },
    { icon: 'team', title: t('landing.tileTeamTitle'), body: t('landing.tileTeamBody'), included: includedIn((plan) => plan.features.includes('marketing_team')) },
    { icon: 'chat', title: t('landing.tileLiaTitle'), body: t('landing.tileLiaBody'), included: includedIn((plan) => plan.features.includes('lia_support') && plan.liaAnswersPerMonth > 0) },
    { icon: 'lock', title: t('landing.tileSecurityTitle'), body: t('landing.tileSecurityBody'), included: everywhere },
    { icon: 'globe', title: t('landing.tileLanguagesTitle'), body: t('landing.tileLanguagesBody'), included: everywhere },
  ]

  const flow = [
    { title: t('landing.flow1Title'), body: t('landing.flow1Body') },
    { title: t('landing.flow2Title'), body: t('landing.flow2Body') },
    { title: t('landing.flow3Title'), body: t('landing.flow3Body') },
    { title: t('landing.flow4Title'), body: t('landing.flow4Body') },
    { title: t('landing.flow5Title'), body: t('landing.flow5Body') },
  ]

  const doors = [
    {
      title: t('landing.door1Title'),
      body: t('landing.door1Body'),
      cta: t('landing.door1Cta'),
      href: findIdea,
    },
    {
      title: t('landing.door2Title'),
      body: t('landing.door2Body'),
      cta: t('landing.door2Cta'),
      href: haveIdea,
    },
    {
      title: t('landing.door3Title'),
      body: t('landing.door3Body'),
      cta: t('landing.door3Cta'),
      href: findIdea,
    },
  ]

  const timeline = [
    t('landing.timeline1'),
    t('landing.timeline2'),
    t('landing.timeline3'),
    t('landing.timeline4'),
    t('landing.timeline5'),
    t('landing.timeline6'),
  ]

  const steps = [
    { title: t('landing.step1Title'), body: t('landing.step1Body') },
    { title: t('landing.step2Title'), body: t('landing.step2Body') },
    { title: t('landing.step3Title'), body: t('landing.step3Body') },
    { title: t('landing.step4Title'), body: t('landing.step4Body') },
    { title: t('landing.step5Title'), body: t('landing.step5Body') },
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

  const demos = DEMO_APPS.map((demo) => ({
    slug: demo.slug,
    name: demo.spec.name,
    category: demo.category,
    summary: demo.summary,
    priceLabel: demo.priceLabel,
    shot: `/demos/${demo.slug}-desktop.webp`,
    shotAlt: demo.shotAlt,
  }))

  const hero = DEMO_APPS.find((demo) => demo.slug === 'devisflow')
  const heroPhone = DEMO_APPS.find((demo) => demo.slug === 'fitpilot')
  const cooksy = DEMO_APPS.find((demo) => demo.slug === 'cooksy')

  return (
    <div className="min-h-screen">
      <LandingHeader
        links={navLinks}
        loginLabel={t('nav.login')}
        loginHref={`/${locale}/connexion`}
        startLabel={t('landing.navStart')}
        startHref={signUp}
        menuLabel={t('landing.navOpenMenu')}
        brand={
          <a href={`/${locale}`} className="text-[var(--color-ink)] no-underline">
            <Logo id="mark-header" wordmark={t('common.appName')} />
          </a>
        }
      />

      {/* ─────────────────────────── 1. Premier écran ─────────────────────── */}
      <section
        className="on-night relative overflow-hidden text-white"
        style={{ background: 'var(--gradient-night)' }}
      >
        {/*
          Deux halos colorés plutôt qu'un. Un seul laissait la moitié gauche du héros
          éteinte, et c'est justement là que se trouve le titre : la lueur chaude le porte.
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

        <div className="relative mx-auto grid w-full max-w-6xl gap-12 px-5 py-16 sm:py-20 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:items-center lg:gap-14 lg:py-28">
          <div>
            <span className="inline-flex items-center rounded-[var(--radius-pill)] border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white/90">
              {t('landing.eyebrow')}
            </span>
            <h1 className="mt-5 text-balance text-[2rem] font-semibold leading-[1.12] tracking-tight sm:text-[2.7rem] xl:text-[3.1rem]">
              {t('landing.heroTitle')}
              <br />
              <span className="text-gradient-brand">{t('landing.heroTitleAccent')}</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-white/75 sm:mt-6 sm:text-lg">
              {t('landing.heroBody')}
            </p>
            <p className="mt-3 max-w-xl text-sm text-white/55">{t('landing.heroSub')}</p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <LinkButton href={findIdea} size="large">
                {t('landing.ctaFindIdea')}
              </LinkButton>
              <a
                href={haveIdea}
                className="inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-white/25 px-6 py-3 text-base font-medium text-white no-underline transition-colors hover:bg-white/10"
              >
                {t('landing.ctaHaveIdea')}
                <span aria-hidden="true">→</span>
              </a>
            </div>
            <p className="mt-5 text-sm text-white/55">{t('landing.heroNote')}</p>
            {privateBeta ? (
              <p className="mt-3 inline-flex rounded-[var(--radius-control)] border border-white/20 bg-white/5 px-3 py-2 text-sm text-white/70">
                {t('landing.heroBeta')}
              </p>
            ) : null}
          </div>

          {/* Montage : deux applications de démonstration, réellement en ligne. */}
          <div>
            <div className="relative">
              {hero !== undefined ? (
                <BrowserFrame
                  src={`/demos/${hero.slug}-desktop.webp`}
                  alt={hero.shotAlt}
                  caption={`evoliia.com/a/${hero.slug}`}
                  priority
                />
              ) : null}
              {heroPhone !== undefined ? (
                <PhoneFrame
                  src={`/demos/${heroPhone.slug}-mobile.webp`}
                  alt={heroPhone.shotAlt}
                  cropHeight={172}
                  className="absolute -bottom-14 -left-6 hidden w-28 sm:block lg:w-32"
                />
              ) : null}
            </div>
            <p className="mt-24 text-center text-xs text-white/45">
              {t('landing.heroShotsCaption')}
            </p>
          </div>
        </div>
      </section>

      {/* ──────────────── 2. Une envie suffit, le parcours en bref ────────── */}
      <Section title={t('landing.flowTitle')} body={t('landing.flowBody')}>
        <FlowRail steps={flow} />
      </Section>

      {/* ──────────────── 3. Vous n'avez pas besoin d'une idée ───────────── */}
      <Section title={t('landing.noIdeaTitle')} body={t('landing.noIdeaBody')} tone="surface">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-stretch">
          <Panel tone="canvas" className="flex flex-col">
            <Eyebrow>{t('landing.profileLabel')}</Eyebrow>
            <dl className="mt-4 mb-0 grid gap-3 text-sm">
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
                  <dd className="m-0 text-right font-medium">{row.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 mb-0 flex items-center gap-2 text-sm text-[var(--color-brand-strong)]">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: 'var(--gradient-cta)' }}
              />
              {t('landing.noIdeaAnalysing')}
            </p>
          </Panel>

          <div
            className="reveal rounded-[var(--radius-card)] p-6 text-white sm:p-7"
            style={{ background: 'var(--gradient-night)' }}
          >
            <Eyebrow tone="light">{t('landing.suggestionLabel')}</Eyebrow>
            <h3 className="mt-3 mb-0 text-xl font-semibold text-balance">
              {t('landing.suggestionName')}
            </h3>
            <dl className="mt-6 mb-0 grid gap-5 sm:grid-cols-2">
              {[
                { label: t('landing.suggestionScore'), value: t('landing.suggestionScoreValue') },
                {
                  label: t('landing.suggestionDifficulty'),
                  value: t('landing.suggestionDifficultyValue'),
                },
                { label: t('landing.suggestionMarket'), value: t('landing.suggestionMarketValue') },
                { label: t('landing.suggestionModel'), value: t('landing.suggestionModelValue') },
                { label: t('landing.suggestionTime'), value: t('landing.suggestionTimeValue') },
                {
                  label: t('landing.suggestionCompetition'),
                  value: t('landing.suggestionCompetitionValue'),
                },
              ].map((row) => (
                <div key={row.label} className="min-w-0">
                  <dt className="text-xs text-white/55">{row.label}</dt>
                  <dd className="m-0 mt-1 text-base font-semibold">{row.value}</dd>
                </div>
              ))}
            </dl>
            <LinkButton href={findIdea} className="mt-7">
              {t('landing.suggestionCta')}
            </LinkButton>
            <p className="mt-5 mb-0 border-t border-white/15 pt-4 text-xs leading-relaxed text-white/50">
              {t('landing.suggestionDisclaimer')}
            </p>
          </div>
        </div>
      </Section>

      {/* ──────────────────── 4. Les trois portes d'entrée ────────────────── */}
      <Section title={t('landing.doorsTitle')} body={t('landing.doorsBody')}>
        <DoorCards doors={doors} />

        {/* Ce que la troisième porte veut dire, en arithmétique plutôt qu'en promesse. */}
        <div className="mt-12">
          <h3 className="m-0 text-lg font-semibold">{t('landing.projectsTitle')}</h3>
          <p className="mt-2 mb-0 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-soft)]">
            {t('landing.projectsBody')}
          </p>
          <p className="mt-4 mb-0 text-sm font-medium text-[var(--color-brand-strong)]">
            {t('landing.projectsGoal')}
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {projects.map((project) => (
              <Panel key={project.name} className="p-5">
                <h4 className="m-0 text-sm font-semibold">{project.name}</h4>
                <p className="mt-3 mb-0 text-2xl font-semibold tracking-tight">
                  {formatAmount(project.priceCents)}
                  <span className="ml-1 text-sm font-normal text-[var(--color-ink-faint)]">
                    {t('landing.pricingPerMonth')}
                  </span>
                </p>
                <p className="mt-3 mb-0 text-sm text-[var(--color-ink-soft)]">
                  {t('landing.projectsCustomers', { count: project.customers })}
                </p>
                <p className="mt-1 mb-0 text-xs text-[var(--color-ink-faint)]">
                  {t('landing.projectsDifficulty')} : {project.difficulty}
                </p>
              </Panel>
            ))}
          </div>
          <p className="mt-5 mb-0 max-w-3xl text-sm leading-relaxed text-[var(--color-ink-faint)]">
            {t('landing.projectsNote')}
          </p>
        </div>
      </Section>

      {/* ─────────── 5. Pas seulement une application, un projet ─────────── */}
      <Section
        title={t('landing.projectTitle')}
        titleAccent={t('landing.projectTitleAccent')}
        tone="surface"
      >
        <Timeline
          steps={timeline}
          covered={t('landing.timelineEvoliia')}
          others={t('landing.timelineOthers')}
        />
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <Panel tone="canvas" edge>
            <p className="m-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              {t('landing.projectLead')}
            </p>
          </Panel>
          <Panel tone="canvas" edge>
            <p className="m-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              {t('landing.projectLead2')}
            </p>
          </Panel>
        </div>
      </Section>

      {/* ───────────────────────── 6. Créé avec Evoliia ───────────────────── */}
      <Section id="exemples" title={t('landing.showcaseTitle')} body={t('landing.showcaseBody')}>
        <DemoGallery
          demos={demos}
          openLabel={t('landing.buildOpen')}
          createLabel={t('landing.buildSimilar')}
          createHref={haveIdea}
        />
        <p className="mt-8 mb-0 text-sm font-medium text-[var(--color-ink-soft)]">
          {t('landing.showcaseDemoNote')}
        </p>
        <p className="mt-3 mb-0 max-w-3xl text-sm leading-relaxed text-[var(--color-ink-faint)]">
          {t('landing.showcaseNote')}
        </p>
      </Section>

      {/* ──────────────────────── 7. Comment ça marche ────────────────────── */}
      <Section
        id="fonctionnement"
        title={t('landing.howTitle')}
        body={t('landing.howBody')}
        tone="surface"
      >
        <NumberedSteps steps={steps} />
      </Section>

      {/* ───────────────────── 8. Ce qu'Evoliia sait faire ────────────────── */}
      <Section
        id="fonctionnalites"
        title={t('landing.featuresTitle')}
        body={t('landing.featuresBody')}
      >
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start">
          <div className="reveal">
            <Eyebrow>{t('landing.oneLinePromptLabel')}</Eyebrow>
            <blockquote className="mt-3 mb-0 rounded-[var(--radius-card)] border border-[var(--color-brand)] bg-[var(--color-brand-soft)] p-5 text-base leading-relaxed sm:text-lg">
              « {t('landing.oneLinePrompt')} »
            </blockquote>
            <CheckList
              className="mt-6 text-[var(--color-ink-soft)]"
              items={[
                t('landing.oneLineFeature1'),
                t('landing.oneLineFeature2'),
                t('landing.oneLineFeature3'),
                t('landing.oneLineFeature4'),
                t('landing.oneLineFeature5'),
                t('landing.oneLineFeature6'),
              ]}
            />
          </div>

          <div className="reveal">
            <Eyebrow>{t('landing.oneLineResultLabel')}</Eyebrow>
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
                  className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-brand-strong)] no-underline"
                >
                  {t('landing.oneLineOpen')}
                  <span aria-hidden="true">→</span>
                </a>
              </>
            ) : null}
          </div>
        </div>

        <Panel tone="canvas" className="mt-10">
          <h3 className="m-0 text-base font-semibold">{t('landing.oneLineEditTitle')}</h3>
          <p className="mt-1 mb-0 max-w-2xl text-sm text-[var(--color-ink-soft)]">
            {t('landing.oneLineEditBody')}
          </p>
          <ul className="m-0 mt-5 grid list-none gap-3 p-0 sm:grid-cols-3">
            {[t('landing.oneLineEdit1'), t('landing.oneLineEdit2'), t('landing.oneLineEdit3')].map(
              (edit) => (
                <li
                  key={edit}
                  className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-sm"
                >
                  « {edit} »
                </li>
              ),
            )}
          </ul>
        </Panel>
      </Section>

      {/* ──────────────────── 8 bis. La vitrine des modules ───────────────── */}
      <section id="modules" className="relative isolate scroll-mt-20 overflow-hidden text-white [background-image:var(--gradient-night)]">
        {/* Deux halos fixes : ils donnent de la profondeur au fond sans rien animer. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-32 top-24 h-96 w-96 rounded-full opacity-40 blur-3xl"
          style={{ background: 'radial-gradient(circle, rgba(248,24,120,0.8), transparent 65%)' }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 bottom-32 h-[28rem] w-[28rem] rounded-full opacity-40 blur-3xl"
          style={{ background: 'radial-gradient(circle, rgba(151,5,244,0.9), transparent 65%)' }}
        />
        <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:py-20 lg:py-28">
          <Eyebrow tone="light">{t('landing.modulesEyebrow')}</Eyebrow>
          <h2 className="mt-3 max-w-3xl text-balance text-[1.9rem] font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            {t('landing.modulesTitle')}
            <br />
            <span className="text-gradient-brand">{t('landing.modulesTitleAccent')}</span>
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/75 sm:text-lg">
            {t('landing.modulesBody')}
          </p>

          <div className="mt-14 sm:mt-20">
            <ModuleShowcase items={showcase} />
          </div>

          <div className="mt-20 border-t border-white/10 pt-14 sm:mt-28">
            <h3 className="m-0 text-balance text-2xl font-semibold sm:text-3xl">{t('landing.modulesGridTitle')}</h3>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/70">{t('landing.modulesGridBody')}</p>
            <div className="mt-8">
              <ModuleGrid tiles={tiles} />
            </div>
          </div>
        </div>
      </section>

      {/* ────────────────────── 9. Préparer son lancement ─────────────────── */}
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
            <Panel key={card.title} tone="canvas" edge>
              <h3 className="m-0 text-base font-semibold">{card.title}</h3>
              <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                {card.body}
              </p>
            </Panel>
          ))}
        </div>

        {/*
          Ce qui vient du parcours, et ce qu'il advient du kit : les deux côte à côte. La
          seconde carte dit la vérité de cette installation, et non une intention. Tant que
          l'envoi est fermé, elle annonce qu'aucune publication n'a lieu, ce qui évite la
          déception de celui qui croirait acheter une publication automatique.
        */}
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div className="reveal rounded-[var(--radius-card)] border-2 border-[var(--color-brand)] bg-[var(--color-brand-soft)] p-6">
            <h3 className="m-0 text-base font-semibold text-[var(--color-brand-strong)]">
              {t('landing.launchSourceTitle')}
            </h3>
            <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              {t('landing.launchSourceBody')}
            </p>
          </div>
          <Panel tone="canvas">
            <h3 className="m-0 text-base font-semibold text-[var(--color-ink-soft)]">
              {socialOpen ? t('landing.launchSendTitle') : t('landing.launchLimitTitle')}
            </h3>
            <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              {socialOpen ? t('landing.launchSendBody') : t('landing.launchLimitBody')}
            </p>
          </Panel>
        </div>

        <p className="mt-6 mb-0 text-sm text-[var(--color-ink-soft)]">
          {t('landing.launchIncluded')}
        </p>
      </Section>

      {/* ──────────────────────────── 10. Tarifs ──────────────────────────── */}
      <Section id="tarifs" title={t('landing.pricingTitle')} body={t('landing.pricingBody')}>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => {
            const features = [
              t('landing.pricingCredits', { count: plan.monthlyCredits }),
              plan.allowBuild
                ? plan.maxProjects === 1
                  ? t('landing.pricingProjectsOne')
                  : t('landing.pricingProjects', { count: plan.maxProjects })
                : t('landing.pricingNoBuild'),
              ...(plan.allowBuild ? [t('landing.pricingBuild'), t('landing.pricingInstall')] : []),
              ...(plan.storageBytes > 0
                ? [t('landing.pricingImages', { size: storageLabel(plan.storageBytes) })]
                : []),
              ...(plan.features.includes(LAUNCH_KIT_FEATURE)
                ? [t('landing.pricingLaunchKit')]
                : []),
              ...(plan.allowCustomDomain ? [t('landing.pricingDomain')] : []),
              ...(plan.allowMobilePrep ? [t('landing.pricingMobile')] : []),
              ...(plan.allowExport ? [t('landing.pricingExport')] : []),
              ...(plan.features.includes('radar') && plan.radarRunsPerMonth > 0
                ? [t('landing.pricingRadar', { count: plan.radarRunsPerMonth })]
                : []),
              ...(plan.features.includes('lia_support') && plan.liaAnswersPerMonth > 0
                ? [t('landing.pricingLia', { count: plan.liaAnswersPerMonth })]
                : []),
            ]
            return (
              <div
                key={plan.id}
                className={
                  plan.isRecommended
                    ? 'ring-brand [--ring-fill:var(--color-surface)] relative flex flex-col rounded-[var(--radius-card)] p-6 shadow-[0_22px_48px_-26px_rgba(151,5,244,0.6)]'
                    : 'relative flex flex-col rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6'
                }
              >
                {plan.isRecommended ? (
                  <span
                    className="absolute -top-3 left-6 rounded-[var(--radius-pill)] px-2.5 py-1 text-xs font-semibold text-white"
                    style={{ background: 'var(--gradient-cta)' }}
                  >
                    {t('landing.pricingRecommended')}
                  </span>
                ) : null}
                <h3 className="m-0 text-base font-semibold">{plan.name}</h3>
                <p className="mt-3 mb-0 text-3xl font-semibold tracking-tight">
                  {plan.priceCents === 0
                    ? t('landing.pricingFree')
                    : formatAmount(plan.priceCents, plan.currency)}
                </p>
                {plan.priceCents > 0 ? (
                  <p className="m-0 text-xs text-[var(--color-ink-faint)]">
                    {t('landing.pricingPerMonth')}
                  </p>
                ) : null}
                <p className="mt-4 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                  {plan.description}
                </p>
                <CheckList items={features} className="mt-5 mb-6 text-[var(--color-ink-soft)]" />
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
        <p className="mt-8 mb-0 max-w-3xl text-sm leading-relaxed text-[var(--color-ink-soft)]">
          {t('landing.pricingNote')}
        </p>
        <p className="mt-3 mb-0 max-w-3xl text-sm leading-relaxed text-[var(--color-ink-faint)]">
          {t('landing.pricingPaymentNote')}
        </p>
      </Section>

      {/* ───────────────────────── 11. Transparence ───────────────────────── */}
      <Section title={t('landing.honestTitle')} body={t('landing.honestBody')} tone="surface">
        <div className="grid gap-5 md:grid-cols-2">
          {[
            t('landing.honest1'),
            t('landing.honest2'),
            t('landing.honest3'),
            t('landing.honest4'),
          ].map((promise) => (
            <Panel key={promise} tone="canvas" className="flex gap-3 py-5">
              <span className="mt-0.5 text-[var(--color-brand)]">
                <Check className="h-5 w-5 shrink-0" />
              </span>
              <p className="m-0 text-sm leading-relaxed">{promise}</p>
            </Panel>
          ))}
        </div>
        <p className="mt-6 mb-0 max-w-3xl text-sm leading-relaxed text-[var(--color-ink-faint)]">
          {t('landing.honestNote')}
        </p>
      </Section>

      {/* ─────────────────────────────── 12. FAQ ──────────────────────────── */}
      <Section title={t('landing.faqTitle')}>
        <div className="grid max-w-3xl gap-3">
          {faq.map((item) => (
            <details
              key={item.q}
              className="group rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-4"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium marker:hidden">
                {item.q}
                <span
                  aria-hidden="true"
                  className="shrink-0 text-[var(--color-ink-faint)] transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-3 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </Section>

      {/* ───────────────────────── 13. Dernier appel ──────────────────────── */}
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
          <h2 className="text-balance text-[1.75rem] font-semibold leading-[1.15] tracking-tight sm:text-4xl">
            {t('landing.finalTitle')}
            <br />
            <span className="text-gradient-brand">{t('landing.finalTitleAccent')}</span>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-white/70">{t('landing.finalBody')}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <LinkButton href={findIdea} size="large">
              {t('landing.ctaFindIdea')}
            </LinkButton>
            <a
              href={haveIdea}
              className="inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-white/25 px-6 py-3 text-base font-medium text-white no-underline transition-colors hover:bg-white/10"
            >
              {t('landing.ctaHaveIdea')}
              <span aria-hidden="true">→</span>
            </a>
          </div>
          <p className="mt-6 text-sm text-white/55">{t('landing.heroNote')}</p>
        </div>
      </section>

      {/* ──────────────────────────────── Pied ────────────────────────────── */}
      <footer className="mx-auto w-full max-w-6xl px-5 py-12">
        <div className="flex flex-wrap items-center gap-6">
          <Logo id="mark-footer" wordmark={t('common.appName')} />
          <p className="m-0 max-w-md text-sm text-[var(--color-ink-soft)]">
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
          <span className="ml-auto text-[var(--color-ink-faint)]">
            © {new Date().getFullYear()} {t('common.appName')}. {t('landing.footerRights')}
          </span>
        </div>
      </footer>
    </div>
  )
}
