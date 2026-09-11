'use client'

import { useState } from 'react'
import type { AppSpec, Block, Page } from '@/server/spec/schema'
import { themeStyle } from './theme'
import { RecordForm } from './RecordForm'
import { RecordList } from './RecordList'
import { AuthPanel } from './AuthPanel'
import { AssistantPanel } from './AssistantPanel'

/**
 * Rendu d'une page d'application générée.
 *
 * Aucune chaîne de l'AppSpec n'est insérée en HTML brut : tout passe par les enfants
 * React, donc échappé. Les liens sont déjà restreints par le schéma à https et mailto.
 */

export type RuntimeContext = {
  projectId: string
  /** Base des liens internes : `/a/<slug>` en production, `/preview/<id>` en aperçu. */
  basePath: string
  endUserEmail: string | null
  /** En aperçu, on signale que l'on regarde le brouillon et non la version en ligne. */
  preview: boolean
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

  return (
    <div style={themeStyle(spec.theme)} className="min-h-full">
      <AppNav spec={spec} currentPageId={page.id} context={context} />
      <main className="mx-auto w-full max-w-3xl px-5 pb-16">
        {page.requiresAuth && context.endUserEmail === null ? (
          <section
            className="my-10 rounded-[var(--app-radius)] border p-6"
            style={{ borderColor: 'var(--app-muted)' }}
          >
            <h1 className="mt-0 text-xl font-semibold">{page.title}</h1>
            <p className="opacity-80">Cette page est réservée aux personnes connectées.</p>
            <AuthPanel
              projectId={context.projectId}
              currentEmail={null}
              allowSignup={spec.auth.allowSignup}
            />
          </section>
        ) : (
          page.blocks.map((block) => (
            <BlockView
              key={block.id}
              block={block}
              spec={spec}
              context={context}
              refreshToken={refreshToken}
              onDataChanged={refresh}
            />
          ))
        )}
      </main>
      <footer className="border-t px-5 py-6 text-center text-xs opacity-60" style={{ borderColor: 'var(--app-muted)' }}>
        {spec.name}
      </footer>
    </div>
  )
}

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

  return (
    <header
      className="border-b"
      style={{ borderColor: 'var(--app-muted)', background: 'var(--app-surface)' }}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4">
        <span className="font-semibold">{spec.name}</span>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {spec.navigation.items.map((item) => (
            <a
              key={item.pageId}
              href={pathOf(item.pageId)}
              className="no-underline"
              style={{
                color: item.pageId === currentPageId ? 'var(--app-primary)' : 'var(--app-text)',
                fontWeight: item.pageId === currentPageId ? 600 : 400,
              }}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  )
}

function BlockView({
  block,
  spec,
  context,
  refreshToken,
  onDataChanged,
}: {
  block: Block
  spec: AppSpec
  context: RuntimeContext
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
      return (
        <section className="py-14 text-center">
          <h1 className="m-0 text-3xl font-semibold sm:text-4xl">{block.title}</h1>
          <p className="mx-auto mt-4 max-w-xl text-base opacity-80">{block.subtitle}</p>
          {block.ctaLabel !== undefined && href !== undefined ? (
            <a
              href={href}
              className="mt-7 inline-block rounded-[var(--app-radius)] px-6 py-3 text-sm font-medium text-white no-underline"
              style={{ background: 'var(--app-primary)' }}
            >
              {block.ctaLabel}
            </a>
          ) : null}
        </section>
      )
    }

    case 'richText':
      return (
        <section className="py-8">
          {block.title !== undefined ? (
            <h2 className="mb-3 text-xl font-semibold">{block.title}</h2>
          ) : null}
          {block.body.split('\n').filter(Boolean).map((paragraph, index) => (
            <p key={index} className="leading-relaxed opacity-90">
              {paragraph}
            </p>
          ))}
        </section>
      )

    case 'features':
      return (
        <section className="py-8">
          {block.title !== undefined ? (
            <h2 className="mb-5 text-xl font-semibold">{block.title}</h2>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {block.items.map((item) => (
              <div
                key={item.title}
                className="rounded-[var(--app-radius)] border p-5"
                style={{ borderColor: 'var(--app-muted)', background: 'var(--app-surface)' }}
              >
                <h3 className="m-0 text-base font-semibold">{item.title}</h3>
                <p className="m-0 mt-2 text-sm opacity-80">{item.body}</p>
              </div>
            ))}
          </div>
        </section>
      )

    case 'faq':
      return (
        <section className="py-8">
          {block.title !== undefined ? (
            <h2 className="mb-4 text-xl font-semibold">{block.title}</h2>
          ) : null}
          <div className="grid gap-3">
            {block.items.map((item) => (
              <details
                key={item.question}
                className="rounded-[var(--app-radius)] border p-4"
                style={{ borderColor: 'var(--app-muted)', background: 'var(--app-surface)' }}
              >
                <summary className="cursor-pointer font-medium">{item.question}</summary>
                <p className="m-0 mt-2 text-sm opacity-80">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>
      )

    case 'stats':
      return (
        <section className="grid gap-4 py-8 sm:grid-cols-3">
          {block.items.map((item) => (
            <div key={item.label} className="text-center">
              <p className="m-0 text-2xl font-semibold" style={{ color: 'var(--app-primary)' }}>
                {item.value}
              </p>
              <p className="m-0 mt-1 text-sm opacity-70">{item.label}</p>
            </div>
          ))}
        </section>
      )

    case 'cta': {
      const href = pageHref(block.pageId) ?? block.href
      return (
        <section
          className="my-8 rounded-[var(--app-radius)] px-6 py-10 text-center"
          style={{ background: 'var(--app-surface)' }}
        >
          <h2 className="m-0 text-xl font-semibold">{block.title}</h2>
          {block.body !== undefined ? <p className="mt-2 opacity-80">{block.body}</p> : null}
          {href !== undefined ? (
            <a
              href={href}
              className="mt-5 inline-block rounded-[var(--app-radius)] px-6 py-3 text-sm font-medium text-white no-underline"
              style={{ background: 'var(--app-primary)' }}
            >
              {block.label}
            </a>
          ) : null}
        </section>
      )
    }

    case 'pricing':
      return (
        <section className="py-8">
          {block.title !== undefined ? (
            <h2 className="mb-5 text-xl font-semibold">{block.title}</h2>
          ) : null}
          {spec.monetization.plans.length === 0 ? (
            <p className="opacity-70">Cette application est gratuite.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              {spec.monetization.plans.map((plan) => (
                <div
                  key={plan.id}
                  className="rounded-[var(--app-radius)] border p-5"
                  style={{
                    borderColor: plan.highlighted ? 'var(--app-primary)' : 'var(--app-muted)',
                    background: 'var(--app-surface)',
                  }}
                >
                  <h3 className="m-0 text-base font-semibold">{plan.name}</h3>
                  <p className="m-0 mt-2 text-2xl font-semibold">
                    {formatPrice(plan.priceCents, spec.monetization.currency)}
                    <span className="text-sm font-normal opacity-70">
                      {plan.interval === 'month' ? ' / mois' : plan.interval === 'year' ? ' / an' : ''}
                    </span>
                  </p>
                  <ul className="mt-3 grid gap-1 pl-5 text-sm opacity-80">
                    {plan.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {block.note !== undefined ? (
            <p className="mt-4 text-sm opacity-70">{block.note}</p>
          ) : null}
          <p className="mt-4 text-xs opacity-60">
            Le paiement en ligne n&apos;est pas encore activé sur cette application.
          </p>
        </section>
      )

    case 'recordForm': {
      const model = spec.dataModels.find((candidate) => candidate.id === block.modelId)
      if (!model) return null
      const needsAccount = model.scope === 'user' && context.endUserEmail === null
      return (
        <section className="py-8">
          {block.title !== undefined ? (
            <h2 className="mb-4 text-xl font-semibold">{block.title}</h2>
          ) : null}
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
        </section>
      )
    }

    case 'recordList': {
      const model = spec.dataModels.find((candidate) => candidate.id === block.modelId)
      if (!model) return null
      return (
        <section className="py-8">
          {block.title !== undefined ? (
            <h2 className="mb-4 text-xl font-semibold">{block.title}</h2>
          ) : null}
          <RecordList
            projectId={context.projectId}
            model={model}
            titleField={block.titleField}
            {...(block.subtitleField !== undefined ? { subtitleField: block.subtitleField } : {})}
            emptyText={block.emptyText}
            allowDelete={block.allowDelete}
            refreshToken={refreshToken}
          />
        </section>
      )
    }

    case 'auth':
      return (
        <section className="py-8">
          <h2 className="mb-2 text-xl font-semibold">{block.title}</h2>
          {block.body !== undefined ? <p className="mb-4 opacity-80">{block.body}</p> : null}
          <AuthPanel
            projectId={context.projectId}
            currentEmail={context.endUserEmail}
            allowSignup={spec.auth.allowSignup}
          />
        </section>
      )

    case 'assistant':
      return (
        <section className="py-8">
          <h2 className="mb-2 text-xl font-semibold">{block.title}</h2>
          {block.intro !== undefined ? <p className="mb-4 opacity-80">{block.intro}</p> : null}
          <AssistantPanel
            projectId={context.projectId}
            blockId={block.id}
            placeholder={block.placeholder}
          />
        </section>
      )
  }
}

function formatPrice(cents: number, currency: string): string {
  if (cents === 0) return 'Gratuit'
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100)
}
