import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslator, resolveLocale, type Locale } from '@/i18n'
import { env } from '@/lib/env'
import { getCurrentUser } from '@/server/auth/session'
import { VISIBILITY_AGENTS } from '@/server/agents/visibility'
import { creditPacks } from '@/server/billing/packs'
import { DEFAULT_ACTION_COSTS, FREE_ACTIONS } from '@/server/billing/action-costs'
import { auditsLabel } from '@/server/billing/plan-details'
import { listPublicPlans } from '@/server/billing/plans'
import { isStripeAvailable } from '@/server/billing/stripe/client'
import { formatAmount } from '@/server/business/economics'
import { jsonLd } from '@/server/seo/visibility'
import { Logo } from '@/components/marketing/Logo'
import { CheckList, Eyebrow, Section } from '@/components/marketing/landing'
import {
  AgentCard,
  AudienceChip,
  CheckFamily,
  DashboardMockup,
  FixExample,
  HonestCard,
  PainCard,
  PriorityExample,
  StepCard,
} from '@/components/marketing/visibility'
import { LandingHeader } from '@/components/marketing/LandingHeader'
import { LinkButton } from '@/components/ui'

/**
 * Page publique.
 *
 * Elle raconte une chose et une seule : votre site est en ligne, et personne ne le trouve.
 * Tout l'ordre des sections en découle — le problème, la manière, l'équipe, la preuve, le
 * prix.
 *
 * Quatre règles la tiennent, et aucune n'est négociable.
 *
 * **Aucun prix n'est écrit ici.** Les offres, leurs bornes et leurs crédits sont lus en
 * base ; les recharges viennent d'un catalogue réglable. Un prix recopié dans une page finit
 * par différer de celui qu'on encaisse, et c'est toujours celui que le client a lu.
 *
 * **Rien n'est inventé.** Ni témoignage, ni logo client, ni compteur d'utilisateurs : nous
 * n'en avons pas. Les chiffres du tableau de bord portent la mention « exemple » dans le
 * même bloc, parce qu'une note sur cent posée sur une page de vente se lit comme un
 * engagement.
 *
 * **Ce qui n'est pas construit est annoncé comme tel.** Les quatre spécialistes portent une
 * étiquette, et leurs fonctions sont déclarées « prévu » dans la grille des droits — ce qui
 * les empêche matériellement d'entrer dans une offre tant qu'elles ne marchent pas.
 *
 * **Aucun bouton ne ment.** Les boutons des exemples — « Corriger avec Néo », « Copier » —
 * sont dessinés et inertes, et ils en ont l'air. Un appel à l'action qui ne fait rien se
 * remarque, et coûte la confiance qu'on vient de gagner.
 */

const TITLE_KEY = 'vis.metaTitle'
const DESCRIPTION_KEY = 'vis.metaDescription'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const locale = resolveLocale((await params).locale)
  const t = getTranslator(locale)
  const title = t(TITLE_KEY)
  const description = t(DESCRIPTION_KEY)
  const url = `${env.appUrl}/${locale}`
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'website', siteName: t('common.appName') },
    twitter: { card: 'summary_large_image', title, description },
  }
}

/**
 * Ce que les moteurs lisent sans l'afficher.
 *
 * Deux blocs seulement. `SoftwareApplication` dit ce qu'est Evoliia et à partir de quel
 * prix — le prix vient de la base, comme partout ailleurs. `FAQPage` reprend les questions
 * déjà écrites plus bas : c'est la forme que les moteurs génératifs citent le plus
 * volontiers, et elle ne demande aucune rédaction supplémentaire.
 *
 * Rien n'y est affirmé qui ne soit visible sur la page. Une donnée structurée qui promet ce
 * que le contenu ne montre pas se retourne contre celui qui la publie.
 */
function donneesStructurees(
  locale: Locale,
  t: ReturnType<typeof getTranslator>,
  offre: { priceCents: number; currency: string } | undefined,
  questions: readonly { q: string; a: string }[],
): Record<string, unknown>[] {
  const url = `${env.appUrl}/${locale}`
  const application: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: t('common.appName'),
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url,
    description: t(DESCRIPTION_KEY),
    inLanguage: locale,
  }
  if (offre !== undefined) {
    application['offers'] = {
      '@type': 'Offer',
      price: (offre.priceCents / 100).toFixed(2),
      priceCurrency: offre.currency,
      url: `${url}#tarifs`,
    }
  }
  return [
    application,
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: questions.map((entree) => ({
        '@type': 'Question',
        name: entree.q,
        acceptedAnswer: { '@type': 'Answer', text: entree.a },
      })),
    },
  ]
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
  if (user !== null) redirect(`/${locale}/visibilite`)

  const [plans, packs] = await Promise.all([listPublicPlans(), creditPacks()])
  // Les trois offres payantes forment la grille ; la gratuite a sa propre section, parce
  // qu'un essai ne se compare pas à un abonnement.
  const payantes = plans.filter((plan) => plan.priceCents > 0)
  const essai = plans.find((plan) => plan.priceCents === 0)
  const premiere = payantes[0]

  const signUp = `/${locale}/inscription`

  const navLinks = [
    { href: '#methode', label: t('vis.navFeatures') },
    { href: '#seo', label: t('vis.navSeo') },
    { href: '#geo', label: t('vis.navGeo') },
    { href: '#equipe', label: t('vis.navTeam') },
    { href: '#postelya', label: 'Postelya' },
    { href: '#tarifs', label: t('vis.navPricing') },
  ]

  const etapes = [
    { title: t('vis.step1Title'), body: t('vis.step1Body') },
    { title: t('vis.step2Title'), body: t('vis.step2Body') },
    { title: t('vis.step3Title'), body: t('vis.step3Body') },
    { title: t('vis.step4Title'), body: t('vis.step4Body') },
  ]

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

  const geoPoints = [
    'Réponses directes',
    'Questions fréquentes',
    'Informations structurées',
    'Entités claires',
    'Contenu précis',
    'Données structurées',
  ]

  const publics = [
    t('vis.audience1'),
    t('vis.audience2'),
    t('vis.audience3'),
    t('vis.audience4'),
    t('vis.audience5'),
    t('vis.audience6'),
    t('vis.audience7'),
  ]

  const differences = [
    { title: t('vis.diff1Title'), body: t('vis.diff1Body') },
    { title: t('vis.diff2Title'), body: t('vis.diff2Body') },
    { title: t('vis.diff3Title'), body: t('vis.diff3Body') },
    { title: t('vis.diff4Title'), body: t('vis.diff4Body') },
  ]

  const honnetete = [
    { title: t('vis.honest1Title'), body: t('vis.honest1Body') },
    { title: t('vis.honest2Title'), body: t('vis.honest2Body') },
    { title: t('vis.honest3Title'), body: t('vis.honest3Body') },
    { title: t('vis.honest4Title'), body: t('vis.honest4Body') },
  ]

  const faq = [
    { q: t('vis.faq7Q'), a: t('vis.faq7A') },
    { q: t('vis.faq2Q'), a: t('vis.faq2A') },
    { q: t('vis.faq1Q'), a: t('vis.faq1A') },
    { q: t('vis.faq6Q'), a: t('vis.faq6A') },
    { q: t('vis.faq3Q'), a: t('vis.faq3A') },
    { q: t('vis.faq4Q'), a: t('vis.faq4A') },
    { q: t('vis.faq8Q'), a: t('vis.faq8A') },
    { q: t('vis.faq5Q'), a: t('vis.faq5A') },
  ]

  /** Ce qu'une offre comprend, entièrement tiré de la base. Aucun chiffre écrit ici. */
  function lignes(plan: (typeof plans)[number]): string[] {
    return [
      plan.sitesMax === 1
        ? t('vis.plansSites', { count: plan.sitesMax })
        : t('vis.plansSitesMany', { count: plan.sitesMax }),
      t('vis.plansPages', { count: plan.pagesPerAudit }),
      auditsLabel(plan, locale),
      t('vis.plansCredits', { count: plan.monthlyCredits }),
      t('vis.plansTeam'),
      t('vis.plansHistory'),
      t('vis.plansPostelya'),
      ...(plan.allowExport ? [t('vis.plansExport')] : []),
    ]
  }

  const comparaison = [
    { label: t('vis.compareSites'), valeur: (p: (typeof plans)[number]) => String(p.sitesMax) },
    { label: t('vis.comparePages'), valeur: (p: (typeof plans)[number]) => String(p.pagesPerAudit) },
    { label: t('vis.compareAudits'), valeur: (p: (typeof plans)[number]) => String(p.auditsPerMonth) },
    { label: t('vis.compareCredits'), valeur: (p: (typeof plans)[number]) => String(p.monthlyCredits) },
    { label: t('vis.compareTeam'), valeur: () => t('vis.compareYes') },
    { label: t('vis.compareHistory'), valeur: () => t('vis.compareYes') },
    { label: t('vis.compareContent'), valeur: () => t('vis.compareYes') },
    { label: t('vis.comparePostelya'), valeur: () => t('vis.compareYes') },
    {
      label: t('vis.compareExports'),
      valeur: (p: (typeof plans)[number]) => (p.allowExport ? t('vis.compareYes') : t('vis.compareNo')),
    },
  ]

  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(donneesStructurees(locale, t, premiere, faq)),
        }}
      />

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
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-5 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-28">
          <div>
            <Eyebrow tone="light">{t('vis.heroEyebrow')}</Eyebrow>
            <h1 className="mt-5 mb-0 text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-5xl">
              {t('vis.heroTitle')}
            </h1>
            <p className="mt-5 mb-0 max-w-xl text-lg leading-relaxed text-white/80">
              {t('vis.heroBody')}
            </p>

            {/*
              Le champ porte l'adresse jusqu'à l'inscription : celui qui a déjà écrit son
              site ne doit pas avoir à le réécrire. Méthode GET vers une page publique, donc
              rien de sensible ne transite.
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

            <p className="mt-4 mb-0 text-sm tracking-wide text-white/70">{t('vis.heroBadges')}</p>
            <div className="mt-5 flex flex-wrap items-center gap-5">
              <a href="#methode" className="text-sm text-white/80">
                {t('vis.heroCtaHow')} →
              </a>
              <span className="text-sm text-white/50">{t('vis.heroNote')}</span>
            </div>
          </div>

          <DashboardMockup
            labels={{
              title: t('vis.mockTitle'),
              seo: t('vis.heroScoreSeo'),
              geo: t('vis.heroScoreGeo'),
              pages: t('vis.mockPages'),
              priorities: t('vis.mockPriorities'),
              sample: t('vis.heroSample'),
              team: t('vis.mockTeam'),
            }}
          />
        </div>
      </section>

      {/* ───────────────────────── 2. Le problème ─────────────────────────── */}
      <Section title={t('vis.painTitle')} body={t('vis.painBody')}>
        <div className="grid gap-4 md:grid-cols-3">
          <PainCard text={t('vis.pain1')} />
          <PainCard text={t('vis.pain2')} />
          <PainCard text={t('vis.pain3')} />
        </div>
        <p className="mt-8 mb-0 text-lg font-medium">{t('vis.painAnswer')}</p>
      </Section>

      {/* ───────────────────────── 3. La méthode ──────────────────────────── */}
      <Section
        id="methode"
        title={t('vis.solutionTitle')}
        body={t('vis.solutionBody')}
        tone="surface"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {etapes.map((etape, index) => (
            <StepCard
              key={etape.title}
              index={index + 1}
              title={etape.title}
              body={etape.body}
            />
          ))}
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
              atWorkLabel={t('vis.teamAtWork')}
            />
          ))}
        </div>
        <p className="mt-8 mb-0 max-w-3xl text-base leading-relaxed">{t('vis.teamHelp')}</p>
        <p className="mt-3 mb-0 max-w-3xl text-sm leading-relaxed text-[var(--color-ink-faint)]">
          {t('vis.teamSoonNote')}
        </p>
      </Section>

      {/* ───────────────────────── 5. Le tableau de bord ──────────────────── */}
      <section
        className="on-night border-y border-[var(--color-night-line)] text-white"
        style={{ background: 'var(--gradient-night)' }}
      >
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-16 lg:grid-cols-2 lg:items-center lg:py-24">
          <div>
            <h2 className="m-0 text-[1.75rem] leading-[1.15] font-semibold tracking-tight text-balance sm:text-4xl">
              {t('vis.dashTitle')}
            </h2>
            <p className="mt-4 mb-0 max-w-xl text-base leading-relaxed text-white/80 sm:text-lg">
              {t('vis.dashBody')}
            </p>
            <p className="mt-6 mb-0 text-base font-medium text-white">{t('vis.dashFollow')}</p>

            {/*
              Trois choses que le tableau de bord fait vraiment, et qu'une capture ne montre
              pas : un état qui survit à l'analyse suivante, une correction qui se vérifie
              toute seule, et une comparaison qui nomme ce qui a bougé. C'est ce qui sépare
              un outil qu'on rouvre d'un rapport qu'on referme.
            */}
            <dl className="m-0 mt-8 grid gap-6">
              {[
                { t: t('vis.dashPlanTitle'), b: t('vis.dashPlanBody') },
                { t: t('vis.dashProofTitle'), b: t('vis.dashProofBody') },
                { t: t('vis.dashHistoryTitle'), b: t('vis.dashHistoryBody') },
              ].map((bloc) => (
                <div key={bloc.t}>
                  <dt className="m-0 text-base font-semibold text-white">{bloc.t}</dt>
                  <dd className="m-0 mt-1.5 text-sm leading-relaxed text-white/70">{bloc.b}</dd>
                </div>
              ))}
            </dl>
          </div>
          <DashboardMockup
            labels={{
              title: t('vis.mockTitle'),
              seo: t('vis.heroScoreSeo'),
              geo: t('vis.heroScoreGeo'),
              pages: t('vis.mockPages'),
              priorities: t('vis.mockPriorities'),
              sample: t('vis.heroSample'),
              team: t('vis.mockTeam'),
            }}
          />
        </div>
      </section>

      {/* ───────────────────────── 6. Le référencement ────────────────────── */}
      <Section id="seo" title={t('vis.seoSectionTitle')} body={t('vis.seoSectionBody')}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {familles.map((famille) => (
            <CheckFamily key={famille.title} title={famille.title} items={famille.items} />
          ))}
        </div>
      </Section>

      {/* ───────────────────────── 7. Les moteurs IA ──────────────────────── */}
      <Section
        id="geo"
        title={t('vis.geoSectionTitle')}
        body={t('vis.geoSectionBody')}
        tone="surface"
      >
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {geoPoints.map((point) => (
            <AudienceChip key={point} label={point} />
          ))}
        </ul>
        {/*
          La retenue est écrite là où l'on parle du sujet, jamais en note de bas de page :
          reléguer l'avertissement plus bas laisserait la promesse s'installer d'abord.
        */}
        <p className="mt-8 mb-0 max-w-3xl rounded-[var(--radius-control)] bg-[var(--color-caution-soft)] p-4 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          {t('vis.geoSectionClaim')}
        </p>
        <p className="mt-4 mb-0 max-w-3xl text-sm leading-relaxed text-[var(--color-ink-faint)]">
          {t('vis.geoWarning')}
        </p>
      </Section>

      {/* ───────────────────────── 8. La correction ───────────────────────── */}
      <Section title={t('vis.fixTitle')} body={t('vis.fixBody')}>
        <FixExample
          problemLabel={t('vis.fixProblem')}
          problem={t('vis.fixProblemText')}
          agentLabel={t('vis.fixAgent')}
          proposalLabel={t('vis.fixProposal')}
          proposal={t('vis.fixProposalText')}
          copyLabel={t('vis.fixCopy')}
        />
        <p className="mt-6 mb-0 max-w-3xl text-base leading-relaxed">{t('vis.fixNote')}</p>
      </Section>

      {/* ───────────────────────── 9. Par quoi commencer ──────────────────── */}
      <Section title={t('vis.prioTitle')} body={t('vis.prioBody')} tone="surface">
        <PriorityExample
          badge={t('vis.prioBadge')}
          headline={t('vis.prioHeadline')}
          why={t('vis.prioWhy')}
          cta={t('vis.prioCta')}
        />
        <p className="mt-4 mb-0 text-sm text-[var(--color-ink-faint)]">{t('vis.prioNote')}</p>
      </Section>

      {/* ───────────────────────── 10. Le contenu ─────────────────────────── */}
      <Section title={t('vis.contentTitle')} body={t('vis.contentBody')}>
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {['Articles', 'FAQ', 'Descriptions produits', 'Pages catégories', 'Titles', 'Meta descriptions', 'Introductions'].map(
            (item) => (
              <AudienceChip key={item} label={item} />
            ),
          )}
        </ul>
        <p className="mt-8 mb-0 max-w-3xl text-base leading-relaxed">{t('vis.contentNote')}</p>
      </Section>

      {/* ───────────────────────── 11. Postelya ───────────────────────────── */}
      <Section
        id="postelya"
        title={t('vis.postelyaTitle')}
        body={t('vis.postelyaBody')}
        tone="surface"
      >
        <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
          <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-center">
            <p className="m-0 text-lg font-semibold">{t('vis.bridgeEvoliia')}</p>
            <p className="m-0 mt-1 text-sm text-[var(--color-ink-faint)]">
              {t('vis.bridgeEvoliiaSub')}
            </p>
          </div>
          <span
            aria-hidden="true"
            className="justify-self-center rounded-[var(--radius-pill)] px-4 py-2 text-sm font-medium text-white"
            style={{ background: 'var(--gradient-cta)' }}
          >
            {t('vis.bridgeArrow')} ↓
          </span>
          <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-center">
            <p className="m-0 text-lg font-semibold">Postelya</p>
            <p className="m-0 mt-1 text-sm text-[var(--color-ink-faint)]">
              {t('vis.bridgeNetworks')}
            </p>
          </div>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <LinkButton href={env.postelyaUrl} variant="secondary">
            {t('vis.postelyaCta')}
          </LinkButton>
          <span className="text-sm text-[var(--color-ink-faint)]">{t('vis.postelyaSoon')}</span>
        </div>
      </Section>

      {/* ───────────────────────── 12. Pour qui ───────────────────────────── */}
      <Section title={t('vis.audienceTitle')} body={t('vis.audienceBody')}>
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {publics.map((nom) => (
            <AudienceChip key={nom} label={nom} />
          ))}
        </ul>
      </Section>

      {/* ───────────────────────── 13. La différence ──────────────────────── */}
      <Section title={t('vis.diffTitle')} body={t('vis.diffBody')} tone="surface">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {differences.map((point) => (
            <HonestCard key={point.title} title={point.title}>
              {point.body}
            </HonestCard>
          ))}
        </div>
      </Section>

      {/* ───────────────────────── 14. Les offres ─────────────────────────── */}
      <Section id="tarifs" title={t('vis.plansTitle')} body={t('vis.plansBody')}>
        <div className="grid gap-5 lg:grid-cols-3">
          {payantes.map((plan) => (
            <div
              key={plan.id}
              className={
                plan.isRecommended
                  ? 'ring-brand [--ring-fill:var(--color-surface)] relative flex flex-col rounded-[var(--radius-card)] p-7 shadow-[0_28px_60px_-30px_rgba(151,5,244,0.65)] lg:-mt-4 lg:pb-9'
                  : 'relative flex flex-col rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-7'
              }
            >
              {plan.isRecommended ? (
                <span
                  className="absolute -top-3 left-7 rounded-[var(--radius-pill)] px-3 py-1 text-xs font-semibold text-white"
                  style={{ background: 'var(--gradient-cta)' }}
                >
                  {t('vis.plansPopular')}
                </span>
              ) : null}
              <h3 className="m-0 text-lg font-semibold">{plan.name}</h3>
              <p className="mt-4 mb-0 flex items-baseline gap-1.5">
                <span className="text-4xl font-semibold tracking-tight">
                  {formatAmount(plan.priceCents, plan.currency)}
                </span>
                <span className="text-sm text-[var(--color-ink-faint)]">
                  {t('vis.plansPerMonth')}
                </span>
              </p>
              <p className="mt-4 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                {plan.description}
              </p>
              <CheckList items={lignes(plan)} className="mt-6 mb-7 text-[var(--color-ink-soft)]" />
              <LinkButton
                href={signUp}
                variant={plan.isRecommended ? 'primary' : 'secondary'}
                className="mt-auto w-full"
              >
                {t('vis.plansCta', { plan: plan.name })}
              </LinkButton>
            </div>
          ))}
        </div>

        {/* L'essai, à part : il ne se compare pas à un abonnement. */}
        {essai === undefined ? null : (
          <div className="mt-8 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-7">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="max-w-2xl">
                <h3 className="m-0 text-lg font-semibold">{t('vis.trialTitle')}</h3>
                <p className="mt-3 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                  {t('vis.trialBody')}
                </p>
              </div>
              <LinkButton href={signUp} variant="secondary">
                {t('vis.plansFreeCta')}
              </LinkButton>
            </div>
          </div>
        )}

        {/* ── Comparatif ── */}
        <h3 className="mt-14 mb-6 text-lg font-semibold">{t('vis.compareTitle')}</h3>
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)]">
                <th className="p-4 text-left font-medium text-[var(--color-ink-faint)]" />
                {payantes.map((plan) => (
                  <th key={plan.id} className="p-4 text-left font-semibold">
                    {plan.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparaison.map((ligne) => (
                <tr key={ligne.label} className="border-b border-[var(--color-line)] last:border-0">
                  <th className="p-4 text-left font-medium text-[var(--color-ink-soft)]">
                    {ligne.label}
                  </th>
                  {payantes.map((plan) => (
                    <td key={plan.id} className="p-4">
                      {ligne.valeur(plan)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Recharges ── */}
        <h3 className="mt-14 mb-2 text-lg font-semibold">{t('vis.packsTitle')}</h3>
        <p className="mt-0 mb-6 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-soft)]">
          {t('vis.packsBody')}
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          {packs.map((pack) => (
            <div
              key={pack.id}
              className={
                pack.isRecommended
                  ? 'rounded-[var(--radius-card)] border border-[var(--color-brand)]/40 bg-[var(--color-brand-soft)] p-6'
                  : 'rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6'
              }
            >
              <p className="m-0 text-base font-semibold">
                {t('vis.packsCredits', { count: pack.credits })}
              </p>
              <p className="mt-2 mb-0 text-2xl font-semibold tracking-tight">
                {formatAmount(pack.priceCents, pack.currency)}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-4 mb-0 max-w-3xl text-sm leading-relaxed text-[var(--color-ink-faint)]">
          {t('vis.packsNote')}
        </p>

        {/* ── Ce qui coûte, ce qui ne coûte rien ── */}
        <h3 className="mt-14 mb-6 text-lg font-semibold">{t('vis.costsTitle')}</h3>
        <div className="grid gap-5 md:grid-cols-2">
          <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
            <p className="m-0 text-xs font-semibold tracking-wide text-[var(--color-positive)] uppercase">
              {t('vis.costsFree')}
            </p>
            <CheckList items={[...FREE_ACTIONS]} className="mt-4 text-[var(--color-ink-soft)]" />
          </div>
          <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
            <p className="m-0 text-xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
              {t('vis.costsPaid')}
            </p>
            <ul className="m-0 mt-4 grid list-none gap-2 p-0 text-sm text-[var(--color-ink-soft)]">
              {DEFAULT_ACTION_COSTS.map((cout) => (
                <li key={cout.id} className="flex justify-between gap-4">
                  <span>{cout.label}</span>
                  <span className="shrink-0 font-medium text-[var(--color-ink)]">
                    {cout.min === cout.max ? cout.min : `${cout.min}–${cout.max}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-4 mb-0 max-w-3xl text-sm leading-relaxed text-[var(--color-ink-faint)]">
          {t('vis.costsNote')}
        </p>

        <div className="mt-14 text-center">
          <h3 className="m-0 text-xl font-semibold">{t('vis.pricingCtaTitle')}</h3>
          <LinkButton href={signUp} className="mt-6">
            {t('vis.heroCta')}
          </LinkButton>
          <p className="mt-3 mb-0 text-sm text-[var(--color-ink-faint)]">
            {t('vis.pricingCtaNote')}
          </p>
        </div>
        <p className="mt-10 mb-0 max-w-3xl text-sm leading-relaxed text-[var(--color-ink-faint)]">
          {isStripeAvailable() ? t('landing.pricingStripeNote') : t('landing.pricingPaymentNote')}
        </p>
      </Section>

      {/* ───────────────────────── 15. Transparence ───────────────────────── */}
      <Section title={t('vis.honestTitle')} body={t('vis.honestBody')} tone="surface">
        <div className="grid gap-5 md:grid-cols-2">
          {honnetete.map((point) => (
            <HonestCard key={point.title} title={point.title}>
              {point.body}
            </HonestCard>
          ))}
        </div>
      </Section>

      {/* ───────────────────────── 16. Questions ──────────────────────────── */}
      <Section title={t('vis.faqTitle')}>
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

      {/* ───────────────────────── 17. Dernier appel ──────────────────────── */}
      <section className="mx-auto w-full max-w-6xl px-5 pb-16">
        <div
          className="on-night rounded-[var(--radius-card)] px-8 py-14 text-center text-white"
          style={{ background: 'var(--gradient-night)' }}
        >
          <h2 className="m-0 text-3xl font-semibold tracking-tight text-balance">
            {t('vis.finalTitle')}
          </h2>
          <p className="mx-auto mt-4 mb-0 max-w-2xl text-white/80">{t('vis.finalBody')}</p>
          <LinkButton href={signUp} className="mt-8">
            {t('vis.heroCta')}
          </LinkButton>
        </div>
      </section>

      <footer className="mx-auto w-full max-w-6xl px-5 py-12">
        <div className="flex flex-wrap items-center gap-6">
          <Logo id="mark-footer" wordmark={t('common.appName')} />
          <p className="m-0 max-w-md text-sm text-[var(--color-ink-soft)]">
            {t(DESCRIPTION_KEY)}
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
          <a href={env.postelyaUrl} className="no-underline">
            Postelya
          </a>
          <span className="ml-auto text-[var(--color-ink-faint)]">
            © {new Date().getFullYear()} {t('common.appName')}. {t('landing.footerRights')}
          </span>
        </div>
      </footer>
    </div>
  )
}
