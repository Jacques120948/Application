import { redirect } from 'next/navigation'
import { getTranslator, resolveLocale, type Locale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { listPublicPlans } from '@/server/billing/plans'
import { Logo } from '@/components/marketing/Logo'
import { LinkButton } from '@/components/ui'

/**
 * Page publique.
 *
 * Elle dit d'abord ce qui distingue Evoliia : on part de l'objectif de revenu, pas d'une
 * idée d'application. La grille tarifaire est lue en base, jamais écrite ici, et aucune
 * promesse de gain n'est faite — c'est la règle du produit, elle vaut aussi pour sa page
 * d'accueil.
 */

function formatPrice(cents: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function Check() {
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true">
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

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user !== null) redirect(`/${locale}/dashboard`)

  const t = getTranslator(locale)
  const plans = await listPublicPlans()

  const steps = [
    { title: t('landing.step1Title'), body: t('landing.step1Body') },
    { title: t('landing.step2Title'), body: t('landing.step2Body') },
    { title: t('landing.step3Title'), body: t('landing.step3Body') },
    { title: t('landing.step4Title'), body: t('landing.step4Body') },
    { title: t('landing.step5Title'), body: t('landing.step5Body') },
    { title: t('landing.step6Title'), body: t('landing.step6Body') },
  ]

  const promises = [
    { title: t('landing.honest1Title'), body: t('landing.honest1Body') },
    { title: t('landing.honest2Title'), body: t('landing.honest2Body') },
    { title: t('landing.honest3Title'), body: t('landing.honest3Body') },
  ]

  return (
    <div className="min-h-screen">
      {/* ─────────────────────────── En-tête ─────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-[var(--color-line)] bg-[color-mix(in_srgb,var(--color-surface)_88%,transparent)] backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-5 py-3">
          <a href={`/${locale}`} className="text-[var(--color-ink)] no-underline">
            <Logo
              id="mark-header"
              wordmark={t('common.appName')}
              wordmarkClassName="hidden sm:inline"
            />
          </a>
          <nav className="ml-6 hidden items-center gap-6 text-sm md:flex">
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
            <LinkButton href={`/${locale}/inscription`}>{t('nav.register')}</LinkButton>
          </div>
        </div>
      </header>

      {/* ──────────────────────────── Hero ───────────────────────────── */}
      <section
        className="on-night relative overflow-hidden text-white"
        style={{ background: 'var(--gradient-night)' }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-40 right-[-10%] h-[520px] w-[520px] rounded-full opacity-40 blur-3xl"
          style={{ background: 'var(--gradient-brand)' }}
        />
        <div className="relative mx-auto grid w-full max-w-6xl gap-12 px-5 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-28">
          <div>
            <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white/90">
              {t('landing.eyebrow')}
            </span>
            <h1 className="mt-5 text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
              {t('landing.heroTitle')}
              <br />
              <span className="text-gradient-brand">{t('landing.heroTitleAccent')}</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/75">
              {t('landing.heroBody')}
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <LinkButton href={`/${locale}/inscription`} size="large">
                {t('landing.ctaPrimary')}
              </LinkButton>
              <a
                href="#fonctionnement"
                className="inline-flex items-center justify-center rounded-[var(--radius-control)] border border-white/25 px-6 py-3 text-base font-medium text-white no-underline transition-colors hover:bg-white/10"
              >
                {t('landing.ctaSecondary')}
              </a>
            </div>
            <p className="mt-6 max-w-md text-sm text-white/55">{t('landing.heroNote')}</p>
          </div>

          {/* Aperçu d'une proposition. Explicitement étiqueté « exemple ». */}
          <div className="rounded-[var(--radius-card)] border border-white/15 bg-white/[0.07] p-5 backdrop-blur-sm">
            <span className="inline-flex items-center rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white/85">
              {t('landing.exampleBadge')}
            </span>
            <h2 className="mt-4 text-lg font-semibold">{t('landing.exampleName')}</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              {t('landing.exampleSummary')}
            </p>
            <dl className="mt-6 grid gap-4 sm:grid-cols-3">
              {[
                { label: t('landing.labelPrice'), value: t('landing.examplePrice') },
                { label: t('landing.labelCustomers'), value: t('landing.exampleCustomers') },
                { label: t('landing.labelCost'), value: t('landing.exampleCost') },
              ].map((item) => (
                <div key={item.label}>
                  <dt className="text-xs text-white/55">{item.label}</dt>
                  <dd className="mt-1 text-base font-semibold text-white">{item.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 border-t border-white/15 pt-4 text-xs leading-relaxed text-white/50">
              {t('landing.exampleFootnote')}
            </p>
          </div>
        </div>
      </section>

      {/* ───────────────────────── Différence ────────────────────────── */}
      <section className="mx-auto w-full max-w-6xl px-5 py-20">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight">
          {t('landing.diffTitle')}
        </h2>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
              {t('landing.diffElsewhereTitle')}
            </span>
            <p className="mt-3 text-xl font-medium text-[var(--color-ink-soft)]">
              « {t('landing.diffElsewhereQuote')} »
            </p>
            <p className="mt-4 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              {t('landing.diffElsewhereBody')}
            </p>
          </div>
          <div className="rounded-[var(--radius-card)] border border-[var(--color-brand)] bg-[var(--color-brand-soft)] p-6">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-brand-strong)]">
              {t('landing.diffHereTitle')}
            </span>
            <p className="mt-3 text-xl font-medium text-[var(--color-ink)]">
              « {t('landing.diffHereQuote')} »
            </p>
            <p className="mt-4 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              {t('landing.diffHereBody')}
            </p>
          </div>
        </div>
      </section>

      {/* ────────────────────────── Parcours ─────────────────────────── */}
      <section id="fonctionnement" className="border-y border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="mx-auto w-full max-w-6xl px-5 py-20">
          <h2 className="text-3xl font-semibold tracking-tight">{t('landing.howTitle')}</h2>
          <p className="mt-3 max-w-2xl text-[var(--color-ink-soft)]">{t('landing.howBody')}</p>
          <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {steps.map((step, index) => (
              <li
                key={step.title}
                className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-canvas)] p-5"
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
        </div>
      </section>

      {/* ───────────────────────── Honnêteté ─────────────────────────── */}
      <section className="mx-auto w-full max-w-6xl px-5 py-20">
        <h2 className="text-3xl font-semibold tracking-tight">{t('landing.honestTitle')}</h2>
        <p className="mt-3 max-w-2xl text-[var(--color-ink-soft)]">{t('landing.honestBody')}</p>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {promises.map((item) => (
            <div
              key={item.title}
              className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6"
            >
              <h3 className="text-base font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ─────────────────────────── Tarifs ──────────────────────────── */}
      <section id="tarifs" className="border-y border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="mx-auto w-full max-w-6xl px-5 py-20">
          <h2 className="text-3xl font-semibold tracking-tight">{t('landing.pricingTitle')}</h2>
          <p className="mt-3 max-w-2xl text-[var(--color-ink-soft)]">{t('landing.pricingBody')}</p>

          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => {
              const features = [
                t('landing.pricingCredits', { count: plan.monthlyCredits }),
                plan.allowBuild
                  ? plan.maxProjects === 1
                    ? t('landing.pricingProjectsOne')
                    : t('landing.pricingProjects', { count: plan.maxProjects })
                  : t('landing.pricingNoBuild'),
                ...(plan.allowBuild ? [t('landing.pricingBuild')] : []),
                ...(plan.allowCustomDomain ? [t('landing.pricingDomain')] : []),
                ...(plan.allowMobilePrep ? [t('landing.pricingMobile')] : []),
                ...(plan.allowExport ? [t('landing.pricingExport')] : []),
              ]
              return (
                <div
                  key={plan.id}
                  className={
                    plan.isRecommended
                      ? 'relative flex flex-col rounded-[var(--radius-card)] border-2 border-[var(--color-brand)] bg-[var(--color-surface)] p-6 shadow-[0_18px_40px_-24px_rgba(91,75,232,0.65)]'
                      : 'relative flex flex-col rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6'
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
                      : formatPrice(plan.priceCents, plan.currency, locale)}
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
                    href={`/${locale}/inscription`}
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
        </div>
      </section>

      {/* ───────────────────── Appel à l'action final ─────────────────── */}
      <section className="on-night text-white" style={{ background: 'var(--gradient-night)' }}>
        <div className="mx-auto w-full max-w-3xl px-5 py-20 text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {t('landing.finalTitle')}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-white/70">{t('landing.finalBody')}</p>
          <LinkButton href={`/${locale}/inscription`} size="large" className="mt-8">
            {t('landing.ctaPrimary')}
          </LinkButton>
        </div>
      </section>

      {/* ─────────────────────────── Pied ────────────────────────────── */}
      <footer className="mx-auto w-full max-w-6xl px-5 py-12">
        <div className="flex flex-wrap items-center gap-6">
          <Logo id="mark-footer" wordmark={t('common.appName')} />
          <p className="max-w-md text-sm text-[var(--color-ink-soft)]">
            {t('landing.footerTagline')}
          </p>
          <p className="ml-auto text-xs text-[var(--color-ink-faint)]">
            © {new Date().getFullYear()} Evoliia. {t('landing.footerRights')}
          </p>
        </div>
      </footer>
    </div>
  )
}
