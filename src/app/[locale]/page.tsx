import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslator, resolveLocale } from '@/i18n'
import { env } from '@/lib/env'
import { getCurrentUser } from '@/server/auth/session'
import { VISIBILITY_AGENTS } from '@/server/agents/visibility'
import { listPublicPlans } from '@/server/billing/plans'
import { isStripeAvailable } from '@/server/billing/stripe/client'
import { formatAmount } from '@/server/business/economics'
import { Logo } from '@/components/marketing/Logo'
import { CheckList, Eyebrow, FlowRail, Section } from '@/components/marketing/landing'
import {
  AgentCard,
  CheckFamily,
  HonestCard,
  ScoreDial,
} from '@/components/marketing/visibility'
import { LandingHeader } from '@/components/marketing/LandingHeader'
import { LinkButton } from '@/components/ui'

/**
 * Page publique.
 *
 * Elle raconte une chose et une seule : vous avez un site, et personne ne le trouve. C'est
 * tout le positionnement d'Evoliia, et l'ordre des sections en découle — l'adresse d'abord,
 * puis ce qui se passe ensuite, puis les deux scores, puis qui fait le travail.
 *
 * Trois règles tiennent cette page, et ce sont les mêmes que pour la précédente.
 *
 * **Rien n'y est inventé.** La grille tarifaire est lue en base. Il n'y a ni témoignage, ni
 * logo client, ni compteur d'utilisateurs : nous n'en avons pas. Les deux scores du premier
 * écran portent la mention « exemple » dans le même bloc que le chiffre, parce qu'un nombre
 * sur cent affiché sur une page de vente se lit comme une promesse.
 *
 * **Ce qui n'est pas construit est annoncé comme tel.** Les quatre spécialistes portent une
 * étiquette « en construction », et ce n'est pas une politesse : leurs fonctions sont
 * déclarées « prévu » dans la grille des droits, ce qui les empêche matériellement d'entrer
 * dans une offre. Décrire une équipe au présent avant qu'elle existe est la façon la plus
 * sûre de décevoir quelqu'un qui vient de s'inscrire.
 *
 * **On dit ce qu'on ne promet pas.** Une section entière y est consacrée, et c'est la seule
 * réponse honnête à un marché qui se vend avec des certitudes que personne ne détient.
 * Aucun score ne garantit d'apparaître dans ChatGPT : on l'écrit là où on parle du score,
 * pas en note de bas de page.
 *
 * La mise en forme est déléguée à components/marketing. Ici ne restent que le contenu et son
 * ordre.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const locale = resolveLocale((await params).locale)
  const t = getTranslator(locale)
  const title = t('vis.metaTitle')
  const description = t('vis.metaDescription')
  return {
    title,
    description,
    alternates: { canonical: `${env.appUrl}/${locale}` },
    openGraph: { title, description, url: `${env.appUrl}/${locale}`, type: 'website' },
  }
}

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const locale = resolveLocale((await params).locale)
  const t = getTranslator(locale)

  // Qui est déjà connecté n'a rien à faire sur une page de vente.
  const user = await getCurrentUser()
  if (user !== null) redirect(`/${locale}/dashboard`)

  const plans = await listPublicPlans()
  const signUp = `/${locale}/inscription`

  const navLinks = [
    { href: '#equipe', label: t('vis.navTeam') },
    { href: '#parcours', label: t('vis.navHow') },
    { href: '#tarifs', label: t('vis.navPricing') },
  ]

  const parcours = [
    { title: t('vis.path1Title'), body: t('vis.path1Body') },
    { title: t('vis.path2Title'), body: t('vis.path2Body') },
    { title: t('vis.path3Title'), body: t('vis.path3Body') },
    { title: t('vis.path4Title'), body: t('vis.path4Body') },
    { title: t('vis.path5Title'), body: t('vis.path5Body') },
  ]

  /*
   * Les familles de contrôles sont écrites en clair plutôt que tirées du moteur : ce sont des
   * noms de choses qu'un visiteur reconnaît sur son propre site, pas des identifiants.
   */
  const familles = [
    {
      title: t('vis.checks1Title'),
      items: ['Title', 'Meta description', 'H1', 'H2', 'Structure des titres', 'Canonical'],
    },
    {
      title: t('vis.checks2Title'),
      items: ['Longueur', 'Réponses directes', 'FAQ', 'Listes', 'Tableaux', 'Images et ALT'],
    },
    {
      title: t('vis.checks3Title'),
      items: ['Statut HTTP', 'HTTPS', 'robots.txt', 'Plan du site', 'Redirections', 'Liens internes'],
    },
    {
      title: t('vis.checks4Title'),
      items: ['Organization', 'LocalBusiness', 'Product', 'Article', 'FAQPage', 'Breadcrumb'],
    },
  ]

  const honnetete = [
    { title: t('vis.honest1Title'), body: t('vis.honest1Body') },
    { title: t('vis.honest2Title'), body: t('vis.honest2Body') },
    { title: t('vis.honest3Title'), body: t('vis.honest3Body') },
    { title: t('vis.honest4Title'), body: t('vis.honest4Body') },
  ]

  const faq = [
    { q: t('vis.faq1Q'), a: t('vis.faq1A') },
    { q: t('vis.faq2Q'), a: t('vis.faq2A') },
    { q: t('vis.faq3Q'), a: t('vis.faq3A') },
    { q: t('vis.faq4Q'), a: t('vis.faq4A') },
    { q: t('vis.faq5Q'), a: t('vis.faq5A') },
    { q: t('vis.faq6Q'), a: t('vis.faq6A') },
  ]

  return (
    <div className="min-h-screen">
      <LandingHeader
        links={navLinks}
        loginLabel={t('nav.login')}
        loginHref={`/${locale}/connexion`}
        startLabel={t('vis.navStart')}
        startHref={signUp}
        menuLabel={t('landing.navOpenMenu')}
        brand={
          <a href={`/${locale}`} className="text-[var(--color-ink)] no-underline">
            <Logo id="mark-header" wordmark={t('common.appName')} />
          </a>
        }
      />

      {/* ───────────────────────── 1. Premier écran ───────────────────────── */}
      <section
        className="on-night relative overflow-hidden text-white"
        style={{ background: 'var(--gradient-night)' }}
      >
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-5 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-28">
          <div>
            <Eyebrow tone="light">{t('vis.heroEyebrow')}</Eyebrow>
            <h1 className="mt-5 mb-0 text-4xl leading-[1.08] font-semibold tracking-tight sm:text-5xl">
              {t('vis.heroTitle')}
            </h1>
            <p className="mt-5 mb-0 max-w-xl text-lg leading-relaxed text-white/80">
              {t('vis.heroBody')}
            </p>

            {/*
              Le champ mène à l'inscription en emportant l'adresse saisie : celui qui a déjà
              écrit son site ne doit pas avoir à le réécrire une fois inscrit. Méthode GET
              vers une page publique, donc rien de sensible ne transite.
            */}
            <form action={signUp} method="get" className="mt-8 flex max-w-xl flex-wrap gap-3">
              <input
                type="url"
                name="site"
                required
                placeholder={t('vis.heroPlaceholder')}
                aria-label={t('vis.heroCta')}
                className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-white/20 bg-white/10 px-4 py-3 text-base text-white placeholder:text-white/50"
              />
              <button
                type="submit"
                className="rounded-[var(--radius-control)] px-5 py-3 text-base font-semibold text-white"
                style={{ background: 'var(--gradient-cta)' }}
              >
                {t('vis.heroCta')}
              </button>
            </form>
            <p className="mt-3 mb-0 text-sm text-white/60">{t('vis.heroNote')}</p>
            <a href="#equipe" className="mt-6 inline-block text-sm text-white/80">
              {t('vis.heroCtaSecond')} →
            </a>
          </div>

          <div className="rounded-[var(--radius-card)] border border-white/15 bg-white/5 p-6">
            <p className="m-0 text-xs tracking-wide text-white/60 uppercase">
              {t('vis.heroSample')}
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <ScoreDial label={t('vis.heroScoreSeo')} value={74} delta={6} />
              <ScoreDial label={t('vis.heroScoreGeo')} value={58} delta={11} />
            </div>
            <p className="mt-4 mb-0 text-sm text-white/70">
              <span className="font-semibold text-white">5</span> {t('vis.heroPriorities')}
            </p>
            {/*
              La mention vit dans le même bloc que les chiffres, et non en bas de page : un
              score sur cent se lit comme un engagement si rien ne dit le contraire aussitôt.
            */}
            <p className="mt-2 mb-0 text-xs text-white/50">{t('vis.heroSampleNote')}</p>
          </div>
        </div>
      </section>

      {/* ───────────────────────── 2. Le parcours ─────────────────────────── */}
      <Section id="parcours" title={t('vis.pathTitle')} body={t('vis.pathBody')}>
        <FlowRail steps={parcours} />
      </Section>

      {/* ───────────────────────── 3. Les deux scores ─────────────────────── */}
      <Section title={t('vis.scoresTitle')} body={t('vis.scoresBody')} tone="surface">
        <div className="grid gap-5 md:grid-cols-2">
          <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
            <h3 className="m-0 text-lg font-semibold">{t('vis.seoTitle')}</h3>
            <p className="mt-3 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              {t('vis.seoBody')}
            </p>
          </div>
          <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
            <h3 className="m-0 text-lg font-semibold">{t('vis.geoTitle')}</h3>
            <p className="mt-3 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              {t('vis.geoBody')}
            </p>
            {/*
              L'avertissement est à côté de ce qu'il concerne. Le reléguer plus bas
              reviendrait à laisser la promesse s'installer avant de la corriger.
            */}
            <p className="mt-4 mb-0 rounded-[var(--radius-control)] bg-[var(--color-caution-soft)] p-3 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              {t('vis.geoWarning')}
            </p>
          </div>
        </div>
        <div className="mt-6 rounded-[var(--radius-card)] border border-[var(--color-line)] p-6">
          <h3 className="m-0 text-base font-semibold">{t('vis.scoresHow')}</h3>
          <p className="mt-2 mb-0 max-w-3xl text-sm leading-relaxed text-[var(--color-ink-soft)]">
            {t('vis.scoresHowBody')}
          </p>
        </div>
      </Section>

      {/* ───────────────────────── 4. L'équipe ────────────────────────────── */}
      <Section id="equipe" title={t('vis.teamTitle')} body={t('vis.teamBody')}>
        <div className="grid gap-5 md:grid-cols-2">
          {VISIBILITY_AGENTS.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              handlesLabel={t('vis.teamHandles')}
              askLabel={t('vis.teamAsk')}
              soonLabel={t('vis.teamSoon')}
            />
          ))}
        </div>
        <p className="mt-6 mb-0 max-w-3xl text-sm leading-relaxed text-[var(--color-ink-faint)]">
          {t('vis.teamSoonNote')}
        </p>
      </Section>

      {/* ───────────────────── 5. Ce qui est réellement mesuré ────────────── */}
      <Section title={t('vis.checksTitle')} body={t('vis.checksBody')} tone="surface">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {familles.map((famille) => (
            <CheckFamily key={famille.title} title={famille.title} items={famille.items} />
          ))}
        </div>
      </Section>

      {/* ───────────────────────── 6. Postelya ────────────────────────────── */}
      <Section title={t('vis.postelyaTitle')} body={t('vis.postelyaBody')}>
        <div className="flex flex-wrap items-center gap-4">
          <LinkButton href="https://postelya.com" variant="secondary">
            {t('vis.postelyaCta')}
          </LinkButton>
          <span className="text-sm text-[var(--color-ink-faint)]">{t('vis.postelyaSoon')}</span>
        </div>
      </Section>

      {/* ───────────────────────── 7. Tarifs ──────────────────────────────── */}
      <Section id="tarifs" title={t('vis.pricingTitle')} body={t('vis.pricingBody')} tone="surface">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => (
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
              {/*
                Une seule ligne de contenu, et c'est délibéré : les capacités listées jusqu'ici
                — projets, installation, export mobile — décrivaient le constructeur
                d'applications. Les annoncer sur une page de visibilité vendrait autre chose
                que ce qu'on livre. Les offres elles-mêmes ne sont pas touchées : elles
                appartiennent à l'exploitant, et c'est à lui de les redéfinir.
              */}
              <CheckList
                items={[t('landing.pricingCredits', { count: plan.monthlyCredits })]}
                className="mt-5 mb-6 text-[var(--color-ink-soft)]"
              />
              <LinkButton
                href={signUp}
                variant={plan.isRecommended ? 'primary' : 'secondary'}
                className="mt-auto w-full"
              >
                {t('vis.pricingCta')}
              </LinkButton>
            </div>
          ))}
        </div>
        <p className="mt-8 mb-0 max-w-3xl text-sm leading-relaxed text-[var(--color-ink-faint)]">
          {isStripeAvailable() ? t('landing.pricingStripeNote') : t('landing.pricingPaymentNote')}
        </p>
      </Section>

      {/* ───────────────────────── 8. Transparence ────────────────────────── */}
      <Section title={t('vis.honestTitle')} body={t('vis.honestBody')}>
        <div className="grid gap-5 md:grid-cols-2">
          {honnetete.map((point) => (
            <HonestCard key={point.title} title={point.title}>
              {point.body}
            </HonestCard>
          ))}
        </div>
      </Section>

      {/* ───────────────────────── 9. Questions ───────────────────────────── */}
      <Section title={t('vis.faqTitle')} tone="surface">
        <div className="grid gap-4 md:grid-cols-2">
          {faq.map((entree) => (
            <div
              key={entree.q}
              className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6"
            >
              <h3 className="m-0 text-base font-semibold">{entree.q}</h3>
              <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                {entree.a}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* ───────────────────────── 10. Dernier appel ──────────────────────── */}
      <section className="mx-auto w-full max-w-6xl px-5 pb-16">
        <div
          className="on-night rounded-[var(--radius-card)] px-8 py-12 text-center text-white"
          style={{ background: 'var(--gradient-night)' }}
        >
          <h2 className="m-0 text-3xl font-semibold tracking-tight">{t('vis.heroTitle')}</h2>
          <p className="mx-auto mt-4 mb-0 max-w-2xl text-white/80">{t('vis.heroBody')}</p>
          <LinkButton href={signUp} className="mt-8">
            {t('vis.heroCta')}
          </LinkButton>
        </div>
      </section>

      <footer className="mx-auto w-full max-w-6xl px-5 py-12">
        <div className="flex flex-wrap items-center gap-6">
          <Logo id="mark-footer" wordmark={t('common.appName')} />
          <p className="m-0 max-w-md text-sm text-[var(--color-ink-soft)]">
            {t('vis.metaDescription')}
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
