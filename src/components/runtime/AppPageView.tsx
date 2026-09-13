'use client'

import { useState, type ReactNode } from 'react'
import type { AppSpec, Block, Page } from '@/server/spec/schema'
import { themeStyle } from './theme'
import { RecordForm } from './RecordForm'
import { RecordList } from './RecordList'
import { AuthPanel } from './AuthPanel'
import { AssistantPanel } from './AssistantPanel'
import { InstallPrompt } from './InstallPrompt'

/**
 * Rendu d'une page d'application générée.
 *
 * Aucune chaîne de l'AppSpec n'est insérée en HTML brut : tout passe par les enfants
 * React, donc échappé. Les liens sont déjà restreints par le schéma à https et mailto.
 */

export type RuntimePayments = {
  /** Le créateur a relié son compte Stripe : les offres payantes se choisissent vraiment. */
  enabled: boolean
  purchase: { planId: string; planName: string; status: string } | null
  /** Retour d'une page de paiement Stripe (`?paiement=`). */
  returned: 'succes' | 'annule' | null
}

export type RuntimeContext = {
  projectId: string
  /** Base des liens internes : `/a/<slug>` en production, `/preview/<id>` en aperçu. */
  basePath: string
  endUserEmail: string | null
  /** En aperçu, on signale que l'on regarde le brouillon et non la version en ligne. */
  preview: boolean
  payments?: RuntimePayments
}

export function AppPageView({
  spec,
  page,
  context,
}: {
  spec: AppSpec
  page: Page
  context: RuntimeContext
}) {
  const [refreshToken, setRefreshToken] = useState(0)
  const refresh = () => setRefreshToken((value) => value + 1)

  /*
   * La page n'est plus une colonne unique. Chaque bloc choisit sa largeur : un héros et un
   * appel à l'action prennent toute la fenêtre, le reste reste dans une colonne lisible.
   * C'est ce qui sépare une page qui a de l'allure d'un formulaire centré.
   */
  return (
    <div style={themeStyle(spec.theme)} className="min-h-full">
      <AppNav spec={spec} currentPageId={page.id} context={context} />
      <main className="w-full pb-20">
        {page.requiresAuth && context.endUserEmail === null ? (
          <Column>
            <section
              className="my-12 rounded-[var(--app-radius-lg)] border p-8"
              style={{
                borderColor: 'var(--app-border)',
                background: 'var(--app-surface)',
                boxShadow: 'var(--app-shadow)',
              }}
            >
              <h1 className="mt-0 text-2xl" style={{ fontWeight: 'var(--app-heading-weight)' }}>
                {page.title}
              </h1>
              <p className="opacity-80">Cette page est réservée aux personnes connectées.</p>
              <AuthPanel
                projectId={context.projectId}
                currentEmail={null}
                allowSignup={spec.auth.allowSignup}
              />
            </section>
          </Column>
        ) : (
          page.blocks.map((block, index) => (
            <BlockView
              key={block.id}
              block={block}
              spec={spec}
              context={context}
              position={index}
              refreshToken={refreshToken}
              onDataChanged={refresh}
            />
          ))
        )}
      </main>
      <footer
        className="border-t px-5 py-8 text-center text-xs opacity-60"
        style={{ borderColor: 'var(--app-border)' }}
      >
        {spec.name}
      </footer>
      {/*
        L'aperçu du créateur n'est pas installable : son adresse est provisoire et changera
        à la publication. Lui proposer d'installer un brouillon créerait une icône morte.
      */}
      {context.preview ? null : (
        <InstallPrompt appName={spec.name} scope={`${context.basePath}/`} />
      )}
    </div>
  )
}

/** Colonne de lecture. Tout ce qui n'est pas pleine largeur passe par elle. */
function Column({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className={`mx-auto w-full px-5 ${wide ? 'max-w-5xl' : 'max-w-3xl'}`}>{children}</div>
  )
}

/**
 * Section de contenu.
 *
 * Un fond alterné une section sur deux donne au défilement un rythme que des blocs
 * identiques empilés n'ont jamais. `reveal` est l'animation d'apparition définie dans la
 * feuille de style globale : elle ne coûte aucun JavaScript et se désactive d'elle-même
 * pour qui a demandé moins d'animations.
 */
function Band({
  children,
  position,
  wide = false,
  tinted = false,
}: {
  children: ReactNode
  position: number
  wide?: boolean
  tinted?: boolean
}) {
  const alternate = tinted || position % 2 === 1
  return (
    <section
      className="py-14 sm:py-20"
      style={alternate ? { background: 'var(--app-surface-alt)' } : undefined}
    >
      <Column wide={wide}>
        <div className="reveal">{children}</div>
      </Column>
    </section>
  )
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <h2
      className="m-0 mb-6 text-balance text-2xl sm:text-3xl"
      style={{ fontWeight: 'var(--app-heading-weight)' }}
    >
      {children}
    </h2>
  )
}

/**
 * Grille dont le nombre de colonnes suit le nombre d'éléments.
 *
 * Une seule offre au milieu d'une grille de trois laisse un vide que rien ne justifie, et
 * c'est le genre de détail qui fait qu'une page « sent » le gabarit. Deux éléments se
 * mettent sur deux colonnes, un seul occupe la largeur qu'il mérite.
 */
function columnsFor(count: number): string {
  if (count <= 1) return 'sm:max-w-md'
  if (count === 2) return 'sm:grid-cols-2'
  if (count === 4) return 'sm:grid-cols-2'
  return 'sm:grid-cols-2 lg:grid-cols-3'
}

/** Surface d'une carte : bordure discrète, fond, et une ombre teintée de la marque. */
const CARD =
  'rounded-[var(--app-radius)] border p-6 transition-transform duration-200 hover:-translate-y-0.5'

const cardStyle = {
  borderColor: 'var(--app-border)',
  background: 'var(--app-surface)',
  boxShadow: 'var(--app-shadow)',
} as const

function AppNav({
  spec,
  currentPageId,
  context,
}: {
  spec: AppSpec
  currentPageId: string
  context: RuntimeContext
}) {
  const pathOf = (pageId: string) => {
    const target = spec.pages.find((page) => page.id === pageId)
    return `${context.basePath}/${target?.path ?? ''}`
  }

  /*
   * Barre collante et translucide. Elle suit le défilement au-dessus du héros en dégradé,
   * ce qui donne à l'application l'allure d'un site et non d'un document.
   */
  return (
    <header
      className="sticky top-0 z-20 border-b backdrop-blur-md"
      style={{
        borderColor: 'var(--app-border)',
        background: 'color-mix(in srgb, var(--app-surface) 82%, transparent)',
      }}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4">
        <span className="text-base" style={{ fontWeight: 'var(--app-heading-weight)' }}>
          {spec.name}
        </span>
        <nav className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {spec.navigation.items.map((item) => {
            const current = item.pageId === currentPageId
            return (
              <a
                key={item.pageId}
                href={pathOf(item.pageId)}
                className="relative no-underline transition-opacity duration-150 hover:opacity-70"
                style={{
                  color: current ? 'var(--app-primary)' : 'var(--app-text)',
                  fontWeight: current ? 600 : 450,
                }}
              >
                {item.label}
                {current ? (
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-1.5 left-0 right-0 h-0.5 rounded-full"
                    style={{ background: 'var(--app-gradient)' }}
                  />
                ) : null}
              </a>
            )
          })}
        </nav>
      </div>
    </header>
  )
}

function BlockView({
  block,
  spec,
  context,
  position,
  refreshToken,
  onDataChanged,
}: {
  block: Block
  spec: AppSpec
  context: RuntimeContext
  /** Rang du bloc dans la page : sert à alterner les fonds. */
  position: number
  refreshToken: number
  onDataChanged: () => void
}) {
  const pageHref = (pageId: string | undefined) => {
    if (pageId === undefined) return undefined
    const target = spec.pages.find((page) => page.id === pageId)
    return target ? `${context.basePath}/${target.path}` : undefined
  }

  switch (block.type) {
    case 'hero': {
      const href = pageHref(block.ctaPageId)
      /*
       * Le héros prend toute la fenêtre, sur le dégradé de la marque. C'est le seul
       * endroit de la page où l'on peut se permettre du très grand texte, et c'est ce qui
       * fait qu'une capture d'écran se reconnaît d'un coup d'œil.
       *
       * Les deux halos sont purement décoratifs et construits à partir des couleurs du
       * thème : aucune image à charger, aucun poids supplémentaire, et le résultat suit la
       * palette au lieu de la contredire.
       */
      /*
       * L'adresse porte le projet autant que l'image : c'est ce qui empêche une
       * spécification de pointer vers le fichier d'un autre projet. Elle est la même en
       * aperçu et en ligne, le service se chargeant de la vérification.
       */
      const image =
        block.imageId === undefined
          ? null
          : `/api/app/${context.projectId}/medias/${block.imageId}`

      return (
        <section
          className="relative isolate overflow-hidden"
          style={{ background: 'var(--app-gradient)', color: 'var(--app-on-gradient)' }}
        >
          {/*
            Photo du créateur si elle existe, motif abstrait sinon. Les deux halos ne sont
            pas un pis-aller : ils font le fond quand il n'y a pas d'image, et ils
            entretiennent la couleur de la marque quand il y en a une.
          */}
          {image !== null ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image}
                alt=""
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              />
              {/*
                Deux voiles superposés. Le premier teinte la photo aux couleurs de
                l'application pour qu'elle ne jure pas avec le reste ; le second, plus dense
                vers le bas, garantit la lisibilité du texte quelle que soit l'image — on ne
                sait pas ce que le créateur téléversera.
              */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{ background: 'var(--app-gradient)', opacity: 0.55 }}
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{ background: 'var(--app-scrim)' }}
              />
            </>
          ) : null}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-24 -top-32 h-96 w-96 rounded-full opacity-40 blur-3xl"
            style={{ background: 'var(--app-accent)' }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-40 -right-16 h-[28rem] w-[28rem] rounded-full opacity-25 blur-3xl"
            style={{ background: 'var(--app-surface)' }}
          />
          <Column wide>
            <div className="relative py-24 text-center sm:py-32">
              <h1
                className="m-0 text-balance text-4xl leading-[1.08] tracking-tight sm:text-6xl"
                style={{ fontWeight: 'var(--app-heading-weight)' }}
              >
                {block.title}
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed opacity-85 sm:text-xl">
                {block.subtitle}
              </p>
              {block.ctaLabel !== undefined && href !== undefined ? (
                <a
                  href={href}
                  className="mt-10 inline-block rounded-full px-8 py-4 text-base font-semibold no-underline transition-transform duration-200 hover:-translate-y-0.5"
                  style={{
                    background: 'var(--app-surface)',
                    color: 'var(--app-text)',
                    boxShadow: 'var(--app-shadow-lg)',
                  }}
                >
                  {block.ctaLabel}
                </a>
              ) : null}
            </div>
          </Column>
        </section>
      )
    }

    case 'richText':
      return (
        <Band position={position}>
          {block.title !== undefined ? <Heading>{block.title}</Heading> : null}
          <div className="grid gap-4 text-lg leading-relaxed opacity-90">
            {block.body
              .split('\n')
              .filter(Boolean)
              .map((paragraph, index) => (
                <p key={index} className="m-0 text-pretty">
                  {paragraph}
                </p>
              ))}
          </div>
        </Band>
      )

    case 'features':
      return (
        <Band position={position} wide>
          {block.title !== undefined ? <Heading>{block.title}</Heading> : null}
          <div className={`grid gap-5 ${columnsFor(block.items.length)}`}>
            {block.items.map((item, index) => (
              <div key={item.title} className={CARD} style={cardStyle}>
                {/* Une pastille numérotée aux couleurs de la marque : le repère visuel le
                    plus économique pour qu'une grille ne soit pas un mur de texte. */}
                <span
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold"
                  style={{ background: 'var(--app-gradient)', color: 'var(--app-on-gradient)' }}
                >
                  {index + 1}
                </span>
                <h3 className="mt-4 text-lg" style={{ fontWeight: 'var(--app-heading-weight)' }}>
                  {item.title}
                </h3>
                <p className="m-0 mt-2 leading-relaxed opacity-75">{item.body}</p>
              </div>
            ))}
          </div>
        </Band>
      )

    case 'faq':
      return (
        <Band position={position}>
          {block.title !== undefined ? <Heading>{block.title}</Heading> : null}
          <div className="grid gap-3">
            {block.items.map((item) => (
              <details
                key={item.question}
                className="group rounded-[var(--app-radius)] border p-5"
                style={{ borderColor: 'var(--app-border)', background: 'var(--app-surface)' }}
              >
                <summary className="flex cursor-pointer items-center justify-between gap-4 text-lg font-medium marker:content-['']">
                  {item.question}
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-xl transition-transform duration-200 group-open:rotate-45"
                    style={{ color: 'var(--app-primary)' }}
                  >
                    +
                  </span>
                </summary>
                <p className="m-0 mt-3 leading-relaxed opacity-75">{item.answer}</p>
              </details>
            ))}
          </div>
        </Band>
      )

    case 'stats':
      return (
        <Band position={position} wide>
          <div className={`grid gap-8 ${columnsFor(block.items.length)}`}>
            {block.items.map((item) => (
              <div key={item.label} className="text-center">
                {/* Le chiffre est l'élément le plus grand de la page après le héros :
                    c'est ce qu'on retient d'une capture d'écran. */}
                <p
                  className="m-0 bg-clip-text text-4xl tracking-tight text-transparent sm:text-5xl"
                  style={{
                    backgroundImage: 'var(--app-gradient)',
                    fontWeight: 'var(--app-heading-weight)',
                  }}
                >
                  {item.value}
                </p>
                <p className="m-0 mt-2 text-sm uppercase tracking-wide opacity-60">{item.label}</p>
              </div>
            ))}
          </div>
        </Band>
      )

    case 'cta': {
      const href = pageHref(block.pageId) ?? block.href
      return (
        <section className="py-14 sm:py-20">
          <Column wide>
            <div
              className="reveal relative isolate overflow-hidden rounded-[var(--app-radius-lg)] px-8 py-16 text-center sm:px-12"
              style={{
                background: 'var(--app-gradient)',
                color: 'var(--app-on-gradient)',
                boxShadow: 'var(--app-shadow-lg)',
              }}
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full opacity-30 blur-3xl"
                style={{ background: 'var(--app-accent)' }}
              />
              <h2
                className="relative m-0 text-balance text-3xl tracking-tight sm:text-4xl"
                style={{ fontWeight: 'var(--app-heading-weight)' }}
              >
                {block.title}
              </h2>
              {block.body !== undefined ? (
                <p className="relative mx-auto mt-4 max-w-xl text-lg opacity-85">{block.body}</p>
              ) : null}
              {href !== undefined ? (
                <a
                  href={href}
                  className="relative mt-8 inline-block rounded-full px-8 py-4 text-base font-semibold no-underline transition-transform duration-200 hover:-translate-y-0.5"
                  style={{
                    background: 'var(--app-surface)',
                    color: 'var(--app-text)',
                    boxShadow: 'var(--app-shadow-lg)',
                  }}
                >
                  {block.label}
                </a>
              ) : null}
            </div>
          </Column>
        </section>
      )
    }

    case 'pricing':
      return (
        <Band position={position} wide>
          {block.title !== undefined ? <Heading>{block.title}</Heading> : null}
          <PricingCards spec={spec} context={context} note={block.note} />
        </Band>
      )

    case 'recordForm': {
      const model = spec.dataModels.find((candidate) => candidate.id === block.modelId)
      if (!model) return null
      const needsAccount = model.scope === 'user' && context.endUserEmail === null
      return (
        <Band position={position}>
          {block.title !== undefined ? <Heading>{block.title}</Heading> : null}
          <div
            className="rounded-[var(--app-radius-lg)] border p-6 sm:p-8"
            style={{
              borderColor: 'var(--app-border)',
              background: 'var(--app-surface)',
              boxShadow: 'var(--app-shadow)',
            }}
          >
            <RecordForm
              projectId={context.projectId}
              model={model}
              submitLabel={block.submitLabel}
              successMessage={block.successMessage}
              onCreated={onDataChanged}
              {...(needsAccount
                ? { disabledReason: 'Connectez-vous pour enregistrer vos informations.' }
                : {})}
            />
          </div>
        </Band>
      )
    }

    case 'recordList': {
      const model = spec.dataModels.find((candidate) => candidate.id === block.modelId)
      if (!model) return null
      return (
        <Band position={position}>
          {block.title !== undefined ? <Heading>{block.title}</Heading> : null}
          <RecordList
            projectId={context.projectId}
            model={model}
            titleField={block.titleField}
            {...(block.subtitleField !== undefined ? { subtitleField: block.subtitleField } : {})}
            emptyText={block.emptyText}
            allowDelete={block.allowDelete}
            refreshToken={refreshToken}
          />
        </Band>
      )
    }

    case 'auth':
      return (
        <Band position={position}>
          <Heading>{block.title}</Heading>
          {block.body !== undefined ? (
            <p className="-mt-3 mb-6 text-lg opacity-75">{block.body}</p>
          ) : null}
          <AuthPanel
            projectId={context.projectId}
            currentEmail={context.endUserEmail}
            allowSignup={spec.auth.allowSignup}
          />
        </Band>
      )

    case 'assistant':
      return (
        <Band position={position} tinted>
          <Heading>{block.title}</Heading>
          {block.intro !== undefined ? (
            <p className="-mt-3 mb-6 text-lg opacity-75">{block.intro}</p>
          ) : null}
          <div
            className="rounded-[var(--app-radius-lg)] border p-6 sm:p-8"
            style={{
              borderColor: 'var(--app-border)',
              background: 'var(--app-surface)',
              boxShadow: 'var(--app-shadow)',
            }}
          >
            <AssistantPanel
              projectId={context.projectId}
              blockId={block.id}
              placeholder={block.placeholder}
            />
          </div>
        </Band>
      )
  }
}

/**
 * Les offres d'une application, et le bouton qui mène au paiement.
 *
 * Le paiement n'a lieu que si le créateur a relié son compte Stripe : sinon la grille
 * reste informative et le dit. Le visiteur doit avoir un compte dans l'application pour
 * acheter — un achat sans personne à qui le rattacher ne servirait à rien.
 */
function PricingCards({
  spec,
  context,
  note,
}: {
  spec: AppSpec
  context: RuntimeContext
  note: string | undefined
}) {
  const payments = context.payments
  const enabled = payments?.enabled === true
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(
    payments?.returned === 'succes'
      ? 'Merci ! Votre paiement a bien été reçu.'
      : payments?.returned === 'annule'
        ? 'Paiement abandonné. Rien n’a été débité.'
        : null,
  )
  const authPage = spec.pages.find((page) => page.blocks.some((block) => block.type === 'auth'))

  async function choose(planId: string) {
    if (context.endUserEmail === null) {
      setMessage('Créez un compte ou connectez-vous pour choisir cette offre.')
      return
    }
    setBusy(planId)
    setMessage(null)
    const response = await fetch(`/api/app/${context.projectId}/paiement`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planId }),
    })
    const body = (await response.json().catch(() => ({}))) as { message?: string; url?: string }
    if (!response.ok || body.url === undefined) {
      setBusy(null)
      setMessage(body.message ?? 'Le paiement n’a pas pu commencer.')
      return
    }
    window.location.assign(body.url)
  }

  return (
    <>
      {message !== null ? (
        <p
          className="mb-6 rounded-[var(--app-radius)] border px-4 py-3 text-sm"
          style={{ borderColor: 'var(--app-primary)', background: 'var(--app-surface)' }}
        >
          {message}
          {context.endUserEmail === null && authPage !== undefined ? (
            <>
              {' '}
              <a href={`${context.basePath}/${authPage.path}`} style={{ color: 'var(--app-primary)' }}>
                Se connecter
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      {spec.monetization.plans.length === 0 ? (
        <p className="text-lg opacity-70">Cette application est gratuite.</p>
      ) : (
        <div className={`grid gap-5 ${columnsFor(spec.monetization.plans.length)}`}>
          {spec.monetization.plans.map((plan) => {
            const mine = payments?.purchase?.planId === plan.id
            return (
              <div
                key={plan.id}
                className={`${CARD} flex flex-col`}
                style={{
                  ...cardStyle,
                  // L'offre mise en avant est plus haute et plus marquée. Trois cartes
                  // identiques ne guident personne vers un choix.
                  ...(plan.highlighted || mine
                    ? {
                        borderColor: 'var(--app-primary)',
                        borderWidth: '2px',
                        boxShadow: 'var(--app-shadow-lg)',
                      }
                    : {}),
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="m-0 text-lg" style={{ fontWeight: 'var(--app-heading-weight)' }}>
                    {plan.name}
                  </h3>
                  {mine ? (
                    <span
                      className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-white"
                      style={{ background: 'var(--app-gradient)' }}
                    >
                      Votre offre
                    </span>
                  ) : null}
                </div>
                <p
                  className="m-0 mt-3 text-3xl tracking-tight"
                  style={{ fontWeight: 'var(--app-heading-weight)' }}
                >
                  {formatPrice(plan.priceCents, spec.monetization.currency)}
                  <span className="text-base font-normal opacity-60">
                    {plan.interval === 'month' ? ' / mois' : plan.interval === 'year' ? ' / an' : ''}
                  </span>
                </p>
                <ul className="mt-5 grid list-none gap-2 p-0 text-sm opacity-80">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <span aria-hidden="true" style={{ color: 'var(--app-primary)' }}>
                        ✓
                      </span>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                {enabled && plan.priceCents > 0 && !mine ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void choose(plan.id)}
                    className="mt-6 w-full cursor-pointer rounded-full border-0 px-5 py-3 text-sm font-semibold text-white transition-transform duration-200 hover:-translate-y-0.5 disabled:opacity-60"
                    style={{ background: 'var(--app-gradient)', boxShadow: 'var(--app-shadow)' }}
                  >
                    {busy === plan.id ? 'Redirection…' : 'Choisir cette offre'}
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
      {note !== undefined ? <p className="mt-6 text-sm opacity-70">{note}</p> : null}
      <p className="mt-2 text-xs opacity-55">
        {enabled
          ? `Paiement sécurisé par Stripe, directement auprès de ${spec.name}.`
          : "Le paiement en ligne n'est pas encore activé sur cette application."}
      </p>
    </>
  )
}

function formatPrice(cents: number, currency: string): string {
  if (cents === 0) return 'Gratuit'
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100)
}
