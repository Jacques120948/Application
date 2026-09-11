import type { ReactNode } from 'react'
import { Logo } from './Logo'

/**
 * Cadre des pages légales.
 *
 * Sobre et lisible : ce sont des pages qu'on consulte, pas qu'on vend. Le bloc d'identité
 * est le même partout et dit franchement quand il est incomplet.
 */

export type LegalIdentityView = {
  entity: string
  address: string
  email: string
  country: string
  registration: string
  complete: boolean
}

export function LegalLayout({
  locale,
  title,
  updatedAt,
  children,
}: {
  locale: string
  title: string
  updatedAt: string
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-[var(--color-canvas)]">
      <header className="border-b border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="mx-auto flex w-full max-w-3xl items-center px-5 py-4">
          <a href={`/${locale}`} className="text-[var(--color-ink)] no-underline">
            <Logo id={`mark-legal-${title.length}`} size={28} wordmark="Evoliia" />
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 py-14">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-[var(--color-ink-faint)]">
          Dernière mise à jour : {updatedAt}
        </p>
        <div className="mt-10 grid gap-8 leading-relaxed">{children}</div>
      </main>

      <footer className="border-t border-[var(--color-line)]">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap gap-4 px-5 py-8 text-sm text-[var(--color-ink-soft)]">
          <a href={`/${locale}/mentions-legales`} className="no-underline">
            Mentions légales
          </a>
          <a href={`/${locale}/conditions`} className="no-underline">
            Conditions d’utilisation
          </a>
          <a href={`/${locale}/confidentialite`} className="no-underline">
            Confidentialité
          </a>
          <a href={`/${locale}`} className="ml-auto no-underline">
            Retour à l’accueil
          </a>
        </div>
      </footer>
    </div>
  )
}

export function Article({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="m-0 text-lg font-semibold">{title}</h2>
      <div className="mt-3 grid gap-3 text-[var(--color-ink-soft)]">{children}</div>
    </section>
  )
}

/** Bloc d'identité de l'exploitant, ou avertissement s'il n'est pas renseigné. */
export function IdentityBlock({ identity }: { identity: LegalIdentityView }) {
  if (!identity.complete) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-caution)] bg-[var(--color-caution-soft)] p-5 text-sm">
        <p className="m-0 font-medium text-[var(--color-caution)]">
          Identité de l’éditeur non renseignée
        </p>
        <p className="m-0 mt-2 text-[var(--color-ink-soft)]">
          Cette installation d’Evoliia n’a pas encore déclaré son exploitant. Nous
          préférons l’écrire plutôt qu’afficher un nom inventé. Si vous utilisez ce
          service, demandez ces informations à la personne qui vous y a invité.
        </p>
      </div>
    )
  }

  return (
    <dl className="grid gap-2 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 text-sm">
      <Row label="Éditeur" value={identity.entity} />
      <Row label="Adresse" value={identity.address} />
      <Row label="Pays" value={identity.country} />
      <Row label="Contact" value={identity.email} />
      {identity.registration !== '' ? (
        <Row label="Numéro d’entreprise" value={identity.registration} />
      ) : null}
    </dl>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <dt className="min-w-32 text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="m-0 font-medium">{value}</dd>
    </div>
  )
}
